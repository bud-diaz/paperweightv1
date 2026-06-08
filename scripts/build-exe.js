#!/usr/bin/env node
/**
 * Convenience executable packaging for Paperweight.
 *
 * Public distribution is source/install-script based. This script remains for
 * users who want a native executable on the same platform they build on.
 *
 * Native modules are platform-specific. Build each target on its matching OS
 * and architecture; do not treat --all as a replacement for CI smoke tests.
 */

'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

const ALL_TARGETS = [
  { label: 'Windows x64', target: 'node18-win-x64', out: 'paperweight-win.exe' },
  { label: 'macOS x64', target: 'node18-macos-x64', out: 'paperweight-macos-x64' },
  { label: 'Linux x64', target: 'node18-linux-x64', out: 'paperweight-linux-x64' },
];

const buildAll = process.argv.includes('--all');
const targets = buildAll ? ALL_TARGETS : [ALL_TARGETS[0]];

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
