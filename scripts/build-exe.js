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
  { key: 'win-x64', aliases: ['windows', 'win'], platform: 'win32', arch: 'x64', label: 'Windows x64', target: 'node20-win-x64', out: 'paperweight-win-x64.exe' },
  { key: 'macos-x64', aliases: ['mac-x64'], platform: 'darwin', arch: 'x64', label: 'macOS Intel', target: 'node20-macos-x64', out: 'paperweight-macos-x64' },
  { key: 'macos-arm64', aliases: ['macos', 'mac', 'darwin-arm64'], platform: 'darwin', arch: 'arm64', label: 'macOS Apple Silicon', target: 'node20-macos-arm64', out: 'paperweight-macos-arm64' },
  { key: 'linux-x64', aliases: ['linux'], platform: 'linux', arch: 'x64', label: 'Linux x64', target: 'node20-linux-x64', out: 'paperweight-linux-x64' },
  { key: 'linux-arm64', aliases: ['pi', 'raspberry-pi', 'raspi'], platform: 'linux', arch: 'arm64', label: 'Raspberry Pi / Linux ARM64', target: 'node20-linux-arm64', out: 'paperweight-linux-arm64' },
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

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

console.log('\nPaperweight executable packaging');
console.log('Public distribution remains source/install-script based.\n');
console.log(`Host: ${process.platform}/${process.arch}`);
console.log(`Targets: ${targets.map(t => t.key).join(', ')}\n`);

// Regenerate the client bundle so pkg bundles the latest client/ and hls.js.
run('node scripts/generate-client-bundle.js');

// Generate platform-specific native binding bundle before release:check so the
// package asset check can fail fast on a missing packaged native bundle.
run('node scripts/generate-native-bundle.js');

run('npm run release:check');

const pkgBin = path.join(ROOT, 'node_modules', '.bin', 'pkg');
if (!fs.existsSync(pkgBin) && !fs.existsSync(`${pkgBin}.cmd`)) {
  console.error('ERROR: @yao-pkg/pkg not found. Run npm install first.');
  process.exit(1);
}

const sqliteBuild = path.join(ROOT, 'node_modules', 'better-sqlite3', 'build', 'Release');
if (!fs.existsSync(sqliteBuild)) {
  run('npm rebuild better-sqlite3');
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
