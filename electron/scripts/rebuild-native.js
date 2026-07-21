'use strict';

// Rebuilds better-sqlite3 for Electron's Node ABI into an isolated copy at
// electron/native/node_modules/better-sqlite3 — never the shared root
// node_modules used by `npm test`/`node src/index.js`/pkg builds. Electron's
// own ABI differs from the host Node's, so the two binaries cannot coexist
// in one tree; electron/main.js redirects `require('better-sqlite3')` to
// this copy at runtime (see the Module._resolveFilename override there).
//
// Pass --arch <x64|arm64> to instead (or additionally) build into
// electron/native-<arch>/, used by the mac universal build
// (dist:mac-universal in package.json) to produce both arch-specific
// binaries electron-builder's ${arch}-templated extraResources picks up per
// packaging pass. Always writes to the suffixed directory — even when the
// requested arch matches the host — so both native-x64/ and native-arm64/
// exist as literally-named directories regardless of which one is native.
// Omitting --arch is unchanged: it still rebuilds for the host arch into
// the original unsuffixed electron/native/, which is what main.js's
// dev-time require override and the default stage:runtime/dist/dist:win/
// dist:linux scripts all expect.

const fs = require('fs');
const path = require('path');
const { rebuild } = require('@electron/rebuild');

const rootDir = path.resolve(__dirname, '..', '..');
const electronDir = path.resolve(__dirname, '..');
const srcModule = path.join(rootDir, 'node_modules', 'better-sqlite3');
const nativePackageJson = path.join(electronDir, 'native', 'package.json');

function parseArch(argv) {
  const idx = argv.indexOf('--arch');
  if (idx === -1) return null;
  const value = argv[idx + 1];
  if (!value) {
    console.error('Missing value for --arch (expected x64 or arm64)');
    process.exit(1);
  }
  return value;
}

function copyFresh(src, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true });
}

// The mac universal build (dist:mac-universal) merges the x64 and arm64 native
// dirs and requires every *non-binary* file to be byte-identical across arches.
// @electron/rebuild/node-gyp leave arch-varying text/object files under build/
// (.forge-meta, config.gypi, Makefile, obj.target/**/*.o) that fail the merge
// with "Expected all non-binary files to have identical SHAs". The compiled
// better_sqlite3.node is a Mach-O and is lipo-merged, so it's the only build/
// file that must survive.
function keepOnlyCompiledBinary(destModule) {
  const buildDir = path.join(destModule, 'build');
  const binary = path.join(buildDir, 'Release', 'better_sqlite3.node');
  if (!fs.existsSync(binary)) {
    throw new Error(`Expected compiled binary at ${binary} after rebuild`);
  }
  const buf = fs.readFileSync(binary);
  fs.rmSync(buildDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(binary), { recursive: true });
  fs.writeFileSync(binary, buf);
}

// @electron/rebuild requires a package.json at buildPath/projectRootPath.
// electron/native/ has one checked into git; the arch-suffixed dirs
// (native-arm64/, native-x64/) are generated fresh each build, so seed them
// from the same template here.
function ensureNativeDirPackageJson(nativeDir) {
  const dest = path.join(nativeDir, 'package.json');
  if (fs.existsSync(dest)) return;
  fs.mkdirSync(nativeDir, { recursive: true });
  fs.copyFileSync(nativePackageJson, dest);
}

async function rebuildFor(arch, nativeDir) {
  const electronVersion = require(path.join(electronDir, 'node_modules', 'electron', 'package.json')).version;
  const destModule = path.join(nativeDir, 'node_modules', 'better-sqlite3');

  ensureNativeDirPackageJson(nativeDir);
  fs.mkdirSync(path.dirname(destModule), { recursive: true });
  copyFresh(srcModule, destModule);

  await rebuild({
    buildPath: nativeDir,
    electronVersion,
    arch,
    onlyModules: ['better-sqlite3'],
    force: true,
    // @electron/rebuild walks up ancestor directories looking for
    // node_modules to rebuild, stopping only once it reaches a directory
    // without a package.json. Without this pin it would climb past
    // nativeDir into electron/ and then the repo root, rebuilding (and
    // corrupting) the shared root node_modules/better-sqlite3 used by
    // `npm test`/`node src/index.js`/pkg in the process. Pinning
    // projectRootPath to nativeDir confines the search to this copy only.
    projectRootPath: nativeDir,
  });

  keepOnlyCompiledBinary(destModule);

  console.log(`[Paperweight] Rebuilt better-sqlite3 (${arch}) for Electron ${electronVersion} at ${destModule}`);
}

async function main() {
  const requestedArch = parseArch(process.argv.slice(2));

  if (requestedArch === null) {
    // Unchanged default: rebuild for the host arch into electron/native/.
    await rebuildFor(process.arch, path.join(electronDir, 'native'));
    return;
  }

  // --arch was given explicitly: always use the suffixed directory, even
  // if requestedArch happens to equal the host arch, so both
  // native-x64/ and native-arm64/ exist as literally-named directories
  // for the universal build's ${arch}-templated extraResources.
  await rebuildFor(requestedArch, path.join(electronDir, `native-${requestedArch}`));
}

main().catch(err => {
  console.error('[Paperweight] electron native rebuild failed:', err);
  process.exit(1);
});
