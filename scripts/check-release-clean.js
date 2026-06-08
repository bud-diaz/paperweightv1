#!/usr/bin/env node
// Fails public release checks when the workspace contains unreproducible files.

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
let ok = true;

const forbiddenRootHtml = new Set([
  'index.html',
  'paperweight-dashboard.html',
  'paperweight-install.html',
  'paperweight-logo-directions.html',
  'paperweight-player.html',
  'paperweight-station-sticker.html',
  'paperweight-station.html',
]);

function pass(msg) {
  console.log(`OK   ${msg}`);
}

function fail(msg) {
  console.log(`FAIL ${msg}`);
  ok = false;
}

function git(args) {
  return spawnSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

const status = git(['status', '--porcelain']);
if (status.status !== 0) {
  const detail = status.error?.message || status.stderr?.trim() || status.status;
  fail(`git status failed: ${detail}`);
} else {
  const rows = status.stdout.split(/\r?\n/).filter(Boolean);
  const untracked = rows.filter(row => row.startsWith('??'));
  if (untracked.length) {
    fail(`untracked files present: ${untracked.map(row => row.slice(3)).join(', ')}`);
  } else {
    pass('no untracked files');
  }
}

for (const name of forbiddenRootHtml) {
  if (fs.existsSync(path.join(ROOT, name))) {
    fail(`root export artifact present: ${name}`);
  }
}

const tempFiles = fs.readdirSync(ROOT).filter(name => /(_temp|new_temp|\.tmp)/i.test(name));
if (tempFiles.length) {
  fail(`scratch files present: ${tempFiles.join(', ')}`);
} else {
  pass('no root scratch files');
}

const hlsAsset = path.join(ROOT, 'node_modules', 'hls.js', 'dist', 'hls.min.js');
if (fs.existsSync(hlsAsset)) {
  pass('local hls.js asset is installed');
} else {
  fail('local hls.js asset missing; run npm install');
}

if (!ok) process.exitCode = 1;
else console.log('Release cleanliness check passed.');
