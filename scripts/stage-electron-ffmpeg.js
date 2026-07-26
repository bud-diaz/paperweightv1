#!/usr/bin/env node
// Stages ffmpeg/ffprobe binaries into electron/stage/bin/ for bundling into
// the Electron desktop installer via extraResources. Mirrors the pkg
// executable's FFmpeg bundling (scripts/build-exe.js + scripts/fetch-ffmpeg.js)
// so every distribution path ships FFmpeg consistently — see
// src/runtime/ffmpeg.js for the runtime resolution this staging feeds.
//
// macOS builds a universal (arm64+x64) binary pair via `lipo`, since
// electron-builder's --mac universal target produces a single app bundle for
// both architectures; Windows and Linux stage a single arch, matching the
// architecture of the CI runner building that target (this repo's Electron CI
// matrix builds each OS on its own native-arch runner, so no cross-arch case
// exists there today).
//
// Must run AFTER scripts/build-desktop-runtime.js, which resets and rewrites
// the entire electron/stage/ tree — running before it would have this
// output wiped.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { fetchFfmpeg } = require('./fetch-ffmpeg');

const ROOT = path.resolve(__dirname, '..');
const STAGE_BIN = path.join(ROOT, 'electron', 'stage', 'bin');

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${command} failed (exit ${result.status ?? 'unknown'})`);
}

async function stageSingleArch(platform, arch) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-electron-ffmpeg-'));
  try {
    const { ffmpeg, ffprobe } = await fetchFfmpeg({ platform, arch, dest: tempDir, force: true });
    fs.mkdirSync(STAGE_BIN, { recursive: true });
    const suffix = platform === 'win32' ? '.exe' : '';
    fs.copyFileSync(ffmpeg, path.join(STAGE_BIN, `ffmpeg${suffix}`));
    fs.copyFileSync(ffprobe, path.join(STAGE_BIN, `ffprobe${suffix}`));
    if (platform !== 'win32') {
      fs.chmodSync(path.join(STAGE_BIN, 'ffmpeg'), 0o755);
      fs.chmodSync(path.join(STAGE_BIN, 'ffprobe'), 0o755);
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function stageMacUniversal() {
  const x64Dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-electron-ffmpeg-x64-'));
  const arm64Dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-electron-ffmpeg-arm64-'));
  try {
    const x64 = await fetchFfmpeg({ platform: 'darwin', arch: 'x64', dest: x64Dir, force: true });
    const arm64 = await fetchFfmpeg({ platform: 'darwin', arch: 'arm64', dest: arm64Dir, force: true });

    fs.mkdirSync(STAGE_BIN, { recursive: true });
    run('lipo', ['-create', x64.ffmpeg, arm64.ffmpeg, '-output', path.join(STAGE_BIN, 'ffmpeg')]);
    run('lipo', ['-create', x64.ffprobe, arm64.ffprobe, '-output', path.join(STAGE_BIN, 'ffprobe')]);
    fs.chmodSync(path.join(STAGE_BIN, 'ffmpeg'), 0o755);
    fs.chmodSync(path.join(STAGE_BIN, 'ffprobe'), 0o755);
  } finally {
    fs.rmSync(x64Dir, { recursive: true, force: true });
    fs.rmSync(arm64Dir, { recursive: true, force: true });
  }
}

async function main() {
  const flagIndex = process.argv.indexOf('--platform');
  const platform = flagIndex === -1 ? process.platform : process.argv[flagIndex + 1];

  fs.rmSync(STAGE_BIN, { recursive: true, force: true });

  if (platform === 'darwin') {
    await stageMacUniversal();
  } else {
    await stageSingleArch(platform, process.arch);
  }

  console.log(`[Paperweight] Staged FFmpeg for Electron (${platform}) at ${STAGE_BIN}`);
}

if (require.main === module) {
  main().catch(err => {
    console.error(`[Paperweight] Electron FFmpeg staging failed: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { main, stageSingleArch, stageMacUniversal };
