#!/usr/bin/env node
// Stages the cloudflared binary into electron/stage/bin/ for bundling into
// the Electron desktop installer via extraResources — same rationale and
// pattern as scripts/stage-electron-ffmpeg.js (see that file for the fuller
// explanation of the universal-macOS-binary approach). Must run AFTER
// scripts/build-desktop-runtime.js, which resets electron/stage/.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { fetchCloudflared } = require('./fetch-cloudflared');

const ROOT = path.resolve(__dirname, '..');
const STAGE_BIN = path.join(ROOT, 'electron', 'stage', 'bin');

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${command} failed (exit ${result.status ?? 'unknown'})`);
}

async function stageSingleArch(platform, arch) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-electron-cloudflared-'));
  try {
    const { cloudflared } = await fetchCloudflared({ platform, arch, dest: tempDir, force: true });
    fs.mkdirSync(STAGE_BIN, { recursive: true });
    const dest = path.join(STAGE_BIN, platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
    fs.copyFileSync(cloudflared, dest);
    if (platform !== 'win32') fs.chmodSync(dest, 0o755);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function stageMacUniversal() {
  const x64Dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-electron-cloudflared-x64-'));
  const arm64Dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-electron-cloudflared-arm64-'));
  try {
    const x64 = await fetchCloudflared({ platform: 'darwin', arch: 'x64', dest: x64Dir, force: true });
    const arm64 = await fetchCloudflared({ platform: 'darwin', arch: 'arm64', dest: arm64Dir, force: true });

    fs.mkdirSync(STAGE_BIN, { recursive: true });
    run('lipo', ['-create', x64.cloudflared, arm64.cloudflared, '-output', path.join(STAGE_BIN, 'cloudflared')]);
    fs.chmodSync(path.join(STAGE_BIN, 'cloudflared'), 0o755);
  } finally {
    fs.rmSync(x64Dir, { recursive: true, force: true });
    fs.rmSync(arm64Dir, { recursive: true, force: true });
  }
}

async function main() {
  const flagIndex = process.argv.indexOf('--platform');
  const platform = flagIndex === -1 ? process.platform : process.argv[flagIndex + 1];

  if (platform === 'darwin') {
    await stageMacUniversal();
  } else {
    await stageSingleArch(platform, process.arch);
  }

  console.log(`[Paperweight] Staged cloudflared for Electron (${platform}) at ${STAGE_BIN}`);
}

if (require.main === module) {
  main().catch(err => {
    console.error(`[Paperweight] Electron cloudflared staging failed: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { main, stageSingleArch, stageMacUniversal };
