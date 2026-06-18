#!/usr/bin/env node
/**
 * Convenience executable packaging for Paperweight.
 *
 * Public distribution is source/install-script based. This script remains for
 * users who want a native executable on the same platform they build on.
 *
 * Native modules are platform-specific. Build each target on its matching OS
 * and architecture; do not treat --allow-cross as a release build.
 */

'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

const TARGETS = [
  { key: 'win-x64',     aliases: ['windows', 'win'],                     platform: 'win32',  arch: 'x64',   label: 'Windows x64',                 target: 'node20-win-x64',     nodeVersion: '20.18.1', abi: '115', out: 'paperweight-win-x64.exe' },
  { key: 'macos-x64',   aliases: ['mac-x64'],                             platform: 'darwin', arch: 'x64',   label: 'macOS Intel',                  target: 'node20-macos-x64',   nodeVersion: '20.18.1', abi: '115', out: 'paperweight-macos-x64' },
  { key: 'macos-arm64', aliases: ['macos', 'mac', 'darwin-arm64'],        platform: 'darwin', arch: 'arm64', label: 'macOS Apple Silicon',           target: 'node20-macos-arm64', nodeVersion: '20.18.1', abi: '115', out: 'paperweight-macos-arm64' },
  { key: 'linux-x64',   aliases: ['linux'],                               platform: 'linux',  arch: 'x64',   label: 'Linux x64',                    target: 'node20-linux-x64',   nodeVersion: '20.18.1', abi: '115', out: 'paperweight-linux-x64' },
  { key: 'linux-arm64', aliases: ['pi', 'raspberry-pi', 'raspi'],         platform: 'linux',  arch: 'arm64', label: 'Raspberry Pi / Linux ARM64',    target: 'node20-linux-arm64', nodeVersion: '20.18.1', abi: '115', out: 'paperweight-linux-arm64' },
];

function usage() {
  console.log(`Usage:
  npm run build:exe
  npm run build:exe -- --target linux-arm64
  npm run build:exe -- --all --allow-cross

Targets:
${TARGETS.map(t => `  ${t.key.padEnd(13)} ${t.label}`).join('\n')}
`);
}

function hostTarget() {
  return TARGETS.find(t => t.platform === process.platform && t.arch === process.arch);
}

function findTarget(name) {
  const normalized = String(name || '').trim().toLowerCase();
  return TARGETS.find(t => t.key === normalized || t.target === normalized || t.aliases.includes(normalized));
}

function readTargetArgs(args) {
  const requested = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--target' || arg === '--targets') {
      const value = args[i + 1];
      if (!value) {
        console.error(`Missing value for ${arg}`);
        process.exit(1);
      }
      requested.push(...value.split(','));
      i += 1;
    } else if (arg.startsWith('--target=')) {
      requested.push(...arg.slice('--target='.length).split(','));
    } else if (arg.startsWith('--targets=')) {
      requested.push(...arg.slice('--targets='.length).split(','));
    }
  }
  return requested;
}

const args = process.argv.slice(2);
const allowCross = args.includes('--allow-cross');
if (args.includes('--help') || args.includes('-h')) {
  usage();
  process.exit(0);
}

let targets;
if (args.includes('--all')) {
  targets = TARGETS;
} else {
  const requested = readTargetArgs(args);
  targets = requested.length
    ? requested.map(name => {
      const target = findTarget(name);
      if (!target) {
        console.error(`Unknown executable target: ${name}`);
        usage();
        process.exit(1);
      }
      return target;
    })
    : [hostTarget()].filter(Boolean);
}

if (targets.length === 0) {
  console.error(`No packaged target is configured for ${process.platform}/${process.arch}.`);
  usage();
  process.exit(1);
}

const crossTargets = targets.filter(t => t.platform !== process.platform || t.arch !== process.arch);
if (crossTargets.length && !allowCross) {
  console.error('Refusing to build non-native executable target(s):');
  for (const target of crossTargets) {
    console.error(`  ${target.key} requires ${target.platform}/${target.arch}; host is ${process.platform}/${process.arch}`);
  }
  console.error('\nBuild each target on matching hardware, or pass --allow-cross only for local experiments.');
  process.exit(1);
}

function run(cmd, opts = {}) {
  console.log(`  $ ${cmd}`);
  const result = spawnSync(cmd, { shell: true, stdio: 'inherit', cwd: ROOT, ...opts });
  if (result.status !== 0) {
    console.error(`\nCommand failed (exit ${result.status})`);
    process.exit(result.status ?? 1);
  }
}

function tryRun(cmd, opts = {}) {
  console.log(`  $ ${cmd}`);
  const result = spawnSync(cmd, { shell: true, stdio: 'inherit', cwd: ROOT, ...opts });
  return result.status === 0;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

console.log('\nPaperweight executable packaging');
console.log('Public distribution remains source/install-script based.\n');
console.log(`Host: ${process.platform}/${process.arch} (ABI ${process.versions.modules})`);
console.log(`Targets: ${targets.map(t => t.key).join(', ')}\n`);

// ─── ABI alignment ────────────────────────────────────────────────────────────
// better_sqlite3.node must be compiled for the same Node ABI that pkg bundles
// in the output exe. All current targets use node20 (ABI 115). If the host
// Node ABI differs, attempt to download a prebuilt binary for the target ABI
// via prebuild-install before generating the native bundle.

const uniqueTargetAbis = [...new Set(targets.map(t => t.abi))];
for (const targetAbi of uniqueTargetAbis) {
  if (process.versions.modules === targetAbi) continue;

  const targetEntry = targets.find(t => t.abi === targetAbi);
  const nodeVersion  = targetEntry.nodeVersion;

  console.log(`\nABI mismatch: host ABI ${process.versions.modules}, target ABI ${targetAbi} (Node ${nodeVersion})`);
  console.log('Attempting to download prebuilt better-sqlite3 for the target Node version...');

  const prebuildInstall = path.join(ROOT, 'node_modules', '.bin', 'prebuild-install');
  const sqliteDir = path.join(ROOT, 'node_modules', 'better-sqlite3');

  const prebuildOk = fs.existsSync(prebuildInstall) && tryRun(
    `"${prebuildInstall}" --target ${nodeVersion} --runtime node`,
    { cwd: sqliteDir },
  );

  if (!prebuildOk) {
    console.log('prebuild-install unavailable or failed; trying node-gyp source rebuild...');
    const rebuildOk = tryRun(
      `npm rebuild better-sqlite3 --build-from-source`,
      { env: { ...process.env, npm_config_target: nodeVersion, npm_config_dist_url: 'https://nodejs.org/dist' } },
    );
    if (!rebuildOk) {
      console.error(`\nERROR: Could not rebuild better-sqlite3 for Node ${nodeVersion} (ABI ${targetAbi}).`);
      console.error(`Install Node ${nodeVersion} (e.g. via nvm) and re-run build:exe from there.`);
      process.exit(1);
    }
  }

  console.log(`OK   better-sqlite3 rebuilt for Node ${nodeVersion} / ABI ${targetAbi}`);
}

// Regenerate the client bundle so pkg bundles the latest client/ and hls.js.
run('node scripts/generate-client-bundle.js');

// Generate platform-specific native binding bundle. Runs after the ABI rebuild
// above so the embedded binary matches the pkg target runtime ABI.
// Pass the target ABI via env so the bundle metadata is correct when host ABI differs.
const nativeBundleEnv = uniqueTargetAbis.length === 1 && uniqueTargetAbis[0] !== process.versions.modules
  ? { ...process.env, PAPERWEIGHT_BUNDLE_ABI: uniqueTargetAbis[0] }
  : process.env;
run('node scripts/generate-native-bundle.js', { env: nativeBundleEnv });

// If we downloaded a target-ABI binary above, restore the host-ABI build now
// so that the subsequent `npm test` (inside release:check) runs correctly under
// the host Node version.
if (uniqueTargetAbis.some(a => a !== process.versions.modules)) {
  console.log('\nRestoring host-ABI better-sqlite3 for test run...');
  run('npm rebuild better-sqlite3');
}

// Download FFmpeg/ffprobe for this platform into vendor/ffmpeg/ (skips if present).
run('node scripts/fetch-ffmpeg.js');

// Embed FFmpeg binaries as a Base64 JS bundle so pkg can include them.
// pkg.assets globs are broken for node20 targets; this mirrors the approach
// used for better_sqlite3.node.
run('node scripts/generate-ffmpeg-bundle.js');

run('npm run release:check');

const pkgBin = path.join(ROOT, 'node_modules', '.bin', 'pkg');
if (!fs.existsSync(pkgBin) && !fs.existsSync(`${pkgBin}.cmd`)) {
  console.error('ERROR: @yao-pkg/pkg not found. Run npm install first.');
  process.exit(1);
}

ensureDir(DIST);

for (const { label, target, out } of targets) {
  const outPath = path.join(DIST, out);
  console.log(`\nBuilding ${label} -> dist/${out}`);
  run(`pkg src/launcher.js --target ${target} --output ${outPath} --compress GZip`);
  const size = (fs.statSync(outPath).size / 1024 / 1024).toFixed(1);
  console.log(`OK   ${out} (${size} MB)`);
}

console.log('\nExecutable packaging complete.');
console.log('\nNext: verify the build self-bootstraps in an empty folder with');
console.log('  npm run smoke:exe');
console.log('Run it on this same OS/arch - a native module built here will not load elsewhere.');
