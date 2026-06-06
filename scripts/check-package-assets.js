#!/usr/bin/env node
// Verifies packaging metadata and required bundle assets before build:exe.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let ok = true;

function pass(msg) {
  console.log(`OK   ${msg}`);
}

function fail(msg) {
  console.log(`FAIL ${msg}`);
  ok = false;
}

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

const pkg = readJson('package.json');
const lock = readJson('package-lock.json');

if (pkg.version === lock.version && pkg.version === lock.packages?.['']?.version) {
  pass(`package version aligned: ${pkg.version}`);
} else {
  fail(`version mismatch: package=${pkg.version}, lock=${lock.version}, root=${lock.packages?.['']?.version}`);
}

const pkgAssets = new Set(pkg.pkg?.assets || []);
for (const asset of ['package.json', 'client/**/*', 'node_modules/better-sqlite3/build/Release/*.node']) {
  if ([...pkgAssets].some(entry => entry === asset || entry.includes(asset))) {
    pass(`pkg asset configured: ${asset}`);
  } else {
    fail(`pkg asset missing: ${asset}`);
  }
}

for (const rel of [
  'client/creator.html',
  'client/index.html',
  'client/vendor/hls.min.js',
  'src/index.js',
  'src/launcher.js',
  'scripts/preflight.js',
  'scripts/check-migrations.js',
  'scripts/check-scheduler.js',
  'scripts/check-analytics.js',
  'scripts/smoke.js',
]) {
  if (fs.existsSync(path.join(ROOT, rel))) pass(`required file exists: ${rel}`);
  else fail(`required file missing: ${rel}`);
}

// The shipped player must not pull runtime JS from a CDN — frontend deps are
// vendored locally (client/vendor/). Guard against a CDN <script> regression.
const creatorHtml = fs.readFileSync(path.join(ROOT, 'client', 'creator.html'), 'utf8');
const cdnScript = /<script[^>]+src=["']https?:\/\/[^"']+["']/i.test(creatorHtml);
if (cdnScript) {
  fail('client/creator.html loads a script from a CDN — vendor it under client/vendor/ instead');
} else {
  pass('client/creator.html has no runtime CDN <script> dependency');
}

// Guard against scratch/exported HTML artifacts at the repo root. The shipped
// UI lives in client/; a root-level index.html or paperweight-*.html is a stray
// export that should not be part of a release.
const scratch = fs.readdirSync(ROOT)
  .filter(name => name === 'index.html' || /^paperweight-.*\.html$/.test(name));
if (scratch.length > 0) {
  fail(`scratch HTML artifact(s) at repo root: ${scratch.join(', ')} — move UI into client/ or delete`);
} else {
  pass('no scratch HTML artifacts at repo root');
}

if (!ok) {
  process.exitCode = 1;
} else {
  console.log('Package asset check passed.');
}
