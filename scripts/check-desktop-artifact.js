#!/usr/bin/env node
// Verifies that the Electron runtime staging tree and any unpacked build
// resources do not contain obvious reverse-engineering footguns.

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ELECTRON_DIR = path.join(ROOT, 'electron');
const STAGE = path.join(ELECTRON_DIR, 'stage');

let ok = true;

function pass(msg) {
  console.log(`OK   ${msg}`);
}

function fail(msg) {
  console.log(`FAIL ${msg}`);
  ok = false;
}

function exists(rel) {
  return fs.existsSync(path.join(STAGE, rel));
}

function walk(dir, visit) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    visit(full, entry);
    if (entry.isDirectory()) walk(full, visit);
  }
}

function checkMissing(rel, label) {
  if (exists(rel)) pass(label || `${rel} exists`);
  else fail(`${label || rel} missing`);
}

function checkAbsent(rel, label) {
  if (exists(rel)) fail(`${label || rel} should not be staged`);
  else pass(`${label || rel} absent`);
}

function checkNoSourceMaps(dir, label) {
  const offenders = [];
  walk(dir, full => {
    if (full.endsWith('.map')) offenders.push(path.relative(ROOT, full));
    if (/\.(js|css|html)$/i.test(full)) {
      const text = fs.readFileSync(full, 'utf8');
      if (/sourceMappingURL=/.test(text)) offenders.push(`${path.relative(ROOT, full)} (sourceMappingURL)`);
    }
  });
  if (offenders.length) fail(`${label} contains source map references: ${offenders.slice(0, 5).join(', ')}`);
  else pass(`${label} has no source maps`);
}

function checkStage() {
  if (!fs.existsSync(STAGE)) {
    fail('electron/stage missing; run npm run build:desktop-runtime');
    return;
  }

  checkMissing('src/index.js', 'staged server entry');
  checkMissing('src/client-bundle.js', 'staged bundled client assets');
  checkMissing('node_modules/express/package.json', 'staged runtime dependencies');
  checkMissing('node_modules/better-sqlite3/build/Release/better_sqlite3.node', 'staged Electron SQLite native binding');
  checkMissing('package.json', 'staged runtime package.json');

  checkAbsent('client', 'raw client directory');
  checkAbsent('landing', 'raw landing directory');
  checkAbsent('node_modules/.bin', 'npm bin shims');
  checkAbsent('node_modules/@yao-pkg', 'pkg build tool');
  checkAbsent('node_modules/nodemon', 'nodemon dev tool');
  checkAbsent('node_modules/prebuild-install', 'prebuild-install build helper');
  checkAbsent('node_modules/terser', 'terser build tool');
  checkAbsent('node_modules/commander', 'commander build helper');
  checkAbsent('node_modules/source-map-support', 'source-map-support build helper');
  checkAbsent('src/native-bundle.js', 'pkg native bundle');
  checkAbsent('src/ffmpeg-bundle.js', 'pkg ffmpeg bundle');

  checkNoSourceMaps(path.join(STAGE, 'src'), 'staged first-party runtime');
}

function resourceDirsFromDist() {
  const dist = path.join(ELECTRON_DIR, 'dist');
  const resources = [];
  walk(dist, (full, entry) => {
    if (entry.isDirectory() && entry.name === 'resources') resources.push(full);
  });
  return resources;
}

function checkBuiltResources() {
  const resources = resourceDirsFromDist();
  if (!resources.length) {
    pass('no unpacked Electron resources found to inspect');
    return;
  }

  for (const dir of resources) {
    const rel = path.relative(ROOT, dir);
    const forbidden = [
      'client',
      'landing',
      path.join('node_modules', '.bin'),
      path.join('node_modules', '@yao-pkg'),
      path.join('node_modules', 'nodemon'),
      path.join('node_modules', 'prebuild-install'),
      path.join('node_modules', 'terser'),
      path.join('node_modules', 'commander'),
      path.join('node_modules', 'source-map-support'),
      path.join('src', 'native-bundle.js'),
      path.join('src', 'ffmpeg-bundle.js'),
    ];

    for (const name of forbidden) {
      const target = path.join(dir, name);
      if (fs.existsSync(target)) fail(`${rel} contains forbidden runtime path ${name}`);
    }

    if (!fs.existsSync(path.join(dir, 'src', 'client-bundle.js'))) {
      fail(`${rel} missing src/client-bundle.js`);
    }
    checkNoSourceMaps(path.join(dir, 'src'), rel);
  }
}

checkStage();
checkBuiltResources();

if (!ok) process.exitCode = 1;
else console.log('Desktop artifact hardening check passed.');
