#!/usr/bin/env node
// Assembles distribution zips: each contains the smoke-tested executable,
// a platform setup guide (as SETUP.md), and universal docs/disclaimer.
//
// Run after build:exe completes on each platform:
//   node scripts/package-release.js [--target <target>]
//
// With no --target it packages every exe found in dist/.
// Outputs to releases/ (gitignored).

'use strict';

const { spawnSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const ROOT     = path.resolve(__dirname, '..');
const DIST     = path.join(ROOT, 'dist');
const RELEASES = path.join(ROOT, 'releases');

// Universal docs included in every zip (must exist at project root).
const UNIVERSAL_DOCS = [
  'README.md',
  'DISCLAIMER.md',
  'OPERATIONS.md',
  'TROUBLESHOOTING.md',
];

const TARGETS = [
  {
    key:   'win-x64',
    exe:   'paperweight-win-x64.exe',
    zip:   'paperweight-windows-x64',
    setup: 'SETUP_WINDOWS.md',
  },
  {
    key:   'macos-x64',
    exe:   'paperweight-macos-x64',
    zip:   'paperweight-macos-x64',
    setup: 'SETUP_MACOS.md',
  },
  {
    key:   'macos-arm64',
    exe:   'paperweight-macos-arm64',
    zip:   'paperweight-macos-arm64',
    setup: 'SETUP_MACOS.md',
  },
  {
    key:   'linux-x64',
    exe:   'paperweight-linux-x64',
    zip:   'paperweight-linux-x64',
    setup: 'SETUP_LINUX_PI.md',
  },
  {
    key:   'linux-arm64',
    exe:   'paperweight-linux-arm64',
    zip:   'paperweight-linux-arm64',
    setup: 'SETUP_LINUX_PI.md',
  },
];

function findTarget(name) {
  const n = String(name || '').trim().toLowerCase();
  return TARGETS.find(t => t.key === n || t.exe === n || t.zip === n);
}

// ─── Arg parsing ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
let targets;

const targetIdx = args.indexOf('--target');
if (targetIdx !== -1) {
  const name = args[targetIdx + 1];
  const t = findTarget(name);
  if (!t) {
    console.error(`Unknown target: ${name}`);
    console.error(`Valid targets: ${TARGETS.map(t => t.key).join(', ')}`);
    process.exit(1);
  }
  targets = [t];
} else {
  // Auto-detect: package every exe present in dist/
  targets = TARGETS.filter(t => fs.existsSync(path.join(DIST, t.exe)));
  if (targets.length === 0) {
    console.error('No built executables found in dist/. Run npm run build:exe first.');
    process.exit(1);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function tmpDir() {
  const d = path.join(ROOT, '.pkg-release-tmp');
  if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
  fs.mkdirSync(d);
  return d;
}

function createZip(zipPath, files) {
  // files: array of { src: absolute path, dest: filename inside zip }
  const staging = tmpDir();

  for (const { src, dest } of files) {
    fs.copyFileSync(src, path.join(staging, dest));
  }

  if (process.platform === 'win32') {
    // PowerShell Compress-Archive
    const items = files.map(f => path.join(staging, f.dest)).join("','");
    const result = spawnSync('powershell', [
      '-NoProfile', '-Command',
      `Compress-Archive -Path '${items}' -DestinationPath '${zipPath}' -Force`,
    ], { stdio: 'inherit' });
    if (result.status !== 0) throw new Error('Compress-Archive failed');
  } else {
    const names = files.map(f => f.dest);
    const result = spawnSync('zip', ['-j', zipPath, ...names], {
      cwd: staging,
      stdio: 'inherit',
    });
    if (result.status !== 0) throw new Error('zip command failed');
  }

  fs.rmSync(staging, { recursive: true, force: true });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

if (!fs.existsSync(RELEASES)) fs.mkdirSync(RELEASES, { recursive: true });

let ok = true;

for (const target of targets) {
  const exeSrc = path.join(DIST, target.exe);
  if (!fs.existsSync(exeSrc)) {
    console.log(`SKIP ${target.key} — ${target.exe} not found in dist/`);
    continue;
  }

  const files = [{ src: exeSrc, dest: target.exe }];

  // Platform setup guide → always named SETUP.md inside the zip
  const setupSrc = path.join(ROOT, target.setup);
  if (fs.existsSync(setupSrc)) {
    files.push({ src: setupSrc, dest: 'SETUP.md' });
  } else {
    console.warn(`WARN setup guide not found: ${target.setup}`);
  }

  // Universal docs
  for (const doc of UNIVERSAL_DOCS) {
    const src = path.join(ROOT, doc);
    if (fs.existsSync(src)) {
      files.push({ src, dest: doc });
    } else {
      console.warn(`WARN doc not found: ${doc}`);
    }
  }

  const zipPath = path.join(RELEASES, `${target.zip}.zip`);
  console.log(`Packaging ${target.key} → releases/${target.zip}.zip`);

  try {
    createZip(zipPath, files);
    const sizeMb = (fs.statSync(zipPath).size / 1024 / 1024).toFixed(1);
    console.log(`OK   releases/${target.zip}.zip (${sizeMb} MB)`);
  } catch (err) {
    console.error(`FAIL ${target.key}: ${err.message}`);
    ok = false;
  }
}

// Clean up any leftover staging dir
const tmp = path.join(ROOT, '.pkg-release-tmp');
if (fs.existsSync(tmp)) fs.rmSync(tmp, { recursive: true, force: true });

if (!ok) process.exit(1);
console.log('\nRelease packages ready in releases/');
