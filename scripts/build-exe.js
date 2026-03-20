#!/usr/bin/env node
/**
 * scripts/build-exe.js
 *
 * Builds paperweight.exe for Windows (x64) using @yao-pkg/pkg.
 *
 * Usage:
 *   node scripts/build-exe.js              # builds for windows x64 (default)
 *   node scripts/build-exe.js --all        # builds win/mac/linux
 *
 * IMPORTANT: Run this script ON the target platform (or in CI targeting that
 * platform) so that better-sqlite3's native .node binary matches the OS.
 * Cross-platform builds won't work for native modules.
 *
 * Prerequisites (run once before building):
 *   npm install
 */

'use strict';

const { execSync, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

// ─── Targets ──────────────────────────────────────────────────────────────────

const ALL_TARGETS = [
  { label: 'Windows x64', target: 'node18-win-x64',   out: 'paperweight-win.exe' },
  { label: 'macOS x64',   target: 'node18-macos-x64', out: 'paperweight-mac'     },
  { label: 'Linux x64',   target: 'node18-linux-x64', out: 'paperweight-linux'   },
];

const buildAll = process.argv.includes('--all');
const targets = buildAll ? ALL_TARGETS : [ALL_TARGETS[0]]; // default: windows only

// ─── Helpers ──────────────────────────────────────────────────────────────────

function run(cmd, opts = {}) {
  console.log(`  $ ${cmd}`);
  const result = spawnSync(cmd, { shell: true, stdio: 'inherit', cwd: ROOT, ...opts });
  if (result.status !== 0) {
    console.error(`\nBuild failed (exit ${result.status})`);
    process.exit(result.status ?? 1);
  }
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ─── Pre-flight checks ────────────────────────────────────────────────────────

const pkgBin = path.join(ROOT, 'node_modules', '.bin', 'pkg');
if (!fs.existsSync(pkgBin) && !fs.existsSync(pkgBin + '.cmd')) {
  console.error('ERROR: @yao-pkg/pkg not found. Run `npm install` first.');
  process.exit(1);
}

const sqliteBuild = path.join(ROOT, 'node_modules', 'better-sqlite3', 'build', 'Release');
if (!fs.existsSync(sqliteBuild)) {
  console.log('better-sqlite3 native module not built — running node-pre-gyp...');
  run('npm rebuild better-sqlite3');
}

// ─── Build ───────────────────────────────────────────────────────────────────

ensureDir(DIST);

console.log('\n╔══════════════════════════════════════╗');
console.log('║      PAPERWEIGHT EXE BUILD           ║');
console.log('╚══════════════════════════════════════╝\n');

for (const { label, target, out } of targets) {
  const outPath = path.join(DIST, out);
  console.log(`── Building: ${label} → dist/${out}`);

  run(
    `pkg src/launcher.js --target ${target} --output ${outPath} --compress GZip`,
    { cwd: ROOT }
  );

  const size = (fs.statSync(outPath).size / 1024 / 1024).toFixed(1);
  console.log(`   ✓ ${out} (${size} MB)\n`);
}

console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║  Build complete!                                         ║');
console.log('║                                                          ║');
console.log('║  Distribute: dist/paperweight-win.exe                   ║');
console.log('║                                                          ║');
console.log('║  On first run the exe creates a .env file next to it.   ║');
console.log('║  Edit it to configure your station, then restart.       ║');
console.log('╚══════════════════════════════════════════════════════════╝\n');
