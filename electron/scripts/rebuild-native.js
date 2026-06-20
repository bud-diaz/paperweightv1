'use strict';

// Rebuilds better-sqlite3 for Electron's Node ABI into an isolated copy at
// electron/native/node_modules/better-sqlite3 — never the shared root
// node_modules used by `npm test`/`node src/index.js`/pkg builds. Electron's
// own ABI differs from the host Node's, so the two binaries cannot coexist
// in one tree; electron/main.js redirects `require('better-sqlite3')` to
// this copy at runtime (see the Module._resolveFilename override there).

const fs = require('fs');
const path = require('path');
const { rebuild } = require('@electron/rebuild');

const rootDir = path.resolve(__dirname, '..', '..');
const nativeDir = path.resolve(__dirname, '..', 'native');
const srcModule = path.join(rootDir, 'node_modules', 'better-sqlite3');
const destModule = path.join(nativeDir, 'node_modules', 'better-sqlite3');

function copyFresh(src, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true });
}

async function main() {
  const electronVersion = require(path.join(rootDir, 'electron', 'node_modules', 'electron', 'package.json')).version;

  fs.mkdirSync(path.dirname(destModule), { recursive: true });
  copyFresh(srcModule, destModule);

  await rebuild({
    buildPath: nativeDir,
    electronVersion,
    arch: process.arch,
    onlyModules: ['better-sqlite3'],
    force: true,
    // @electron/rebuild walks up ancestor directories looking for
    // node_modules to rebuild, stopping only once it reaches a directory
    // without a package.json. Without this pin it would climb past
    // native/ into electron/ and then the repo root, rebuilding (and
    // corrupting) the shared root node_modules/better-sqlite3 used by
    // `npm test`/`node src/index.js`/pkg in the process. Pinning
    // projectRootPath to nativeDir confines the search to this copy only.
    projectRootPath: nativeDir,
  });

  console.log(`[Paperweight] Rebuilt better-sqlite3 for Electron ${electronVersion} at ${destModule}`);
}

main().catch(err => {
  console.error('[Paperweight] electron native rebuild failed:', err);
  process.exit(1);
});
