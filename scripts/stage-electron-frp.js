#!/usr/bin/env node
// Stages frpc into electron/stage/bin/ for Electron builds.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { fetchFrp } = require('./fetch-frp');

const ROOT = path.resolve(__dirname, '..');
const STAGE_BIN = path.join(ROOT, 'electron', 'stage', 'bin');

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${command} failed (exit ${result.status ?? 'unknown'})`);
}

async function stageSingleArch(platform, arch) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-electron-frp-'));
  try {
    const { frpc } = await fetchFrp({ platform, arch, dest: tempDir, force: true });
    fs.mkdirSync(STAGE_BIN, { recursive: true });
    const dest = path.join(STAGE_BIN, platform === 'win32' ? 'frpc.exe' : 'frpc');
    fs.copyFileSync(frpc, dest);
    if (platform !== 'win32') fs.chmodSync(dest, 0o755);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function stageMacUniversal() {
  const x64Dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-electron-frp-x64-'));
  const arm64Dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-electron-frp-arm64-'));
  try {
    const x64 = await fetchFrp({ platform: 'darwin', arch: 'x64', dest: x64Dir, force: true });
    const arm64 = await fetchFrp({ platform: 'darwin', arch: 'arm64', dest: arm64Dir, force: true });

    fs.mkdirSync(STAGE_BIN, { recursive: true });
    run('lipo', ['-create', x64.frpc, arm64.frpc, '-output', path.join(STAGE_BIN, 'frpc')]);
    fs.chmodSync(path.join(STAGE_BIN, 'frpc'), 0o755);
  } finally {
    fs.rmSync(x64Dir, { recursive: true, force: true });
    fs.rmSync(arm64Dir, { recursive: true, force: true });
  }
}

async function main() {
  const flagIndex = process.argv.indexOf('--platform');
  const platform = flagIndex === -1 ? process.platform : process.argv[flagIndex + 1];

  if (platform === 'darwin') await stageMacUniversal();
  else await stageSingleArch(platform, process.arch);

  console.log(`[Paperweight] Staged frpc for Electron (${platform}) at ${STAGE_BIN}`);
}

if (require.main === module) {
  main().catch(err => {
    console.error(`[Paperweight] Electron frpc staging failed: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { main, stageSingleArch, stageMacUniversal };
