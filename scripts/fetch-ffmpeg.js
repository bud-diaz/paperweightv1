#!/usr/bin/env node
/**
 * Downloads FFmpeg and ffprobe for the current platform into vendor/ffmpeg/.
 *
 * Sources: BtbN LGPL builds (Windows, Linux x64, Linux arm64).
 *   https://github.com/BtbN/FFmpeg-Builds
 *   License: LGPL 2.1+ — https://ffmpeg.org/legal.html
 *
 * macOS: no automated download — see instructions below.
 *
 * Run standalone:  npm run fetch:ffmpeg
 * Called by:       npm run build:exe  (automatically, skips if already present)
 */

'use strict';

const https   = require('https');
const http    = require('http');
const path    = require('path');
const fs      = require('fs');
const os      = require('os');
const { spawnSync } = require('child_process');

const ROOT       = path.resolve(__dirname, '..');
const VENDOR_DIR = path.join(ROOT, 'vendor', 'ffmpeg');

const FFMPEG_BIN  = process.platform === 'win32' ? 'ffmpeg.exe'  : 'ffmpeg';
const FFPROBE_BIN = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';

const PLATFORM_KEY = `${process.platform}-${process.arch}`;

const SOURCES = {
  'win32-x64': {
    url:    'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-lgpl.zip',
    format: 'zip',
    binDir: 'ffmpeg-master-latest-win64-lgpl/bin',
  },
  'linux-x64': {
    url:    'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-lgpl.tar.xz',
    format: 'tar.xz',
    binDir: 'ffmpeg-master-latest-linux64-lgpl/bin',
  },
  'linux-arm64': {
    url:    'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linuxarm64-lgpl.tar.xz',
    format: 'tar.xz',
    binDir: 'ffmpeg-master-latest-linuxarm64-lgpl/bin',
  },
};

function run(cmd) {
  const result = spawnSync(cmd, { shell: true, stdio: 'inherit', cwd: ROOT });
  if (result.status !== 0) {
    throw new Error(`Command failed (exit ${result.status}): ${cmd}`);
  }
}

function downloadToFile(url, dest) {
  return new Promise((resolve, reject) => {
    let lastPct = -1;

    function get(targetUrl, redirects) {
      if (redirects > 8) { reject(new Error('Too many redirects')); return; }
      const mod = targetUrl.startsWith('https:') ? https : http;
      mod.get(targetUrl, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          get(res.headers.location, redirects + 1);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} fetching ${targetUrl}`));
          return;
        }
        const total = parseInt(res.headers['content-length'] || '0', 10);
        let received = 0;
        const file = fs.createWriteStream(dest);
        res.on('data', chunk => {
          received += chunk.length;
          if (total > 0) {
            const pct = Math.floor((received / total) * 100);
            if (pct !== lastPct) {
              lastPct = pct;
              process.stdout.write(`\r  ${pct}% (${(received / 1024 / 1024).toFixed(0)}/${(total / 1024 / 1024).toFixed(0)} MB)`);
            }
          }
        });
        res.pipe(file);
        file.on('finish', () => { process.stdout.write('\n'); file.close(resolve); });
        file.on('error', reject);
      }).on('error', reject);
    }

    get(url, 0);
  });
}

async function main() {
  const source = SOURCES[PLATFORM_KEY];

  if (!source) {
    if (process.platform === 'darwin') {
      console.error(`\nNo automated FFmpeg download for macOS (${process.arch}).`);
      console.error('Copy FFmpeg binaries to vendor/ffmpeg/ manually:');
      console.error('  brew install ffmpeg');
      console.error('  mkdir -p vendor/ffmpeg');
      console.error('  cp $(brew --prefix)/bin/ffmpeg  vendor/ffmpeg/ffmpeg');
      console.error('  cp $(brew --prefix)/bin/ffprobe vendor/ffmpeg/ffprobe');
    } else {
      console.error(`\nNo FFmpeg source configured for ${PLATFORM_KEY}.`);
    }
    process.exit(1);
  }

  const destFfmpeg  = path.join(VENDOR_DIR, FFMPEG_BIN);
  const destFfprobe = path.join(VENDOR_DIR, FFPROBE_BIN);

  if (fs.existsSync(destFfmpeg) && fs.existsSync(destFfprobe)) {
    const sizeMb = [destFfmpeg, destFfprobe]
      .reduce((sum, f) => sum + fs.statSync(f).size, 0) / 1024 / 1024;
    console.log(`FFmpeg already in vendor/ffmpeg/ (${sizeMb.toFixed(0)} MB) — skipping download.`);
    console.log('Delete vendor/ffmpeg/ to re-download.');
    return;
  }

  fs.mkdirSync(VENDOR_DIR, { recursive: true });

  const tmpDir     = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-ffmpeg-'));
  const archiveDest = path.join(tmpDir, path.basename(source.url));
  const extractDir  = path.join(tmpDir, 'extracted');
  fs.mkdirSync(extractDir);

  try {
    console.log(`\nFetching FFmpeg for ${PLATFORM_KEY} (BtbN LGPL build)...`);
    console.log(`  ${source.url}`);
    await downloadToFile(source.url, archiveDest);

    console.log('  Extracting...');
    if (source.format === 'zip') {
      if (process.platform === 'win32') {
        run(`powershell -Command "Expand-Archive -Path '${archiveDest}' -DestinationPath '${extractDir}' -Force"`);
      } else {
        run(`unzip -q "${archiveDest}" -d "${extractDir}"`);
      }
    } else {
      run(`tar -xJf "${archiveDest}" -C "${extractDir}"`);
    }

    const srcFfmpeg  = path.join(extractDir, source.binDir, FFMPEG_BIN);
    const srcFfprobe = path.join(extractDir, source.binDir, FFPROBE_BIN);

    fs.copyFileSync(srcFfmpeg,  destFfmpeg);
    fs.copyFileSync(srcFfprobe, destFfprobe);

    if (process.platform !== 'win32') {
      fs.chmodSync(destFfmpeg,  0o755);
      fs.chmodSync(destFfprobe, 0o755);
    }

    const totalMb = [destFfmpeg, destFfprobe]
      .reduce((sum, f) => sum + fs.statSync(f).size, 0) / 1024 / 1024;

    console.log(`  vendor/ffmpeg/ ready (${totalMb.toFixed(0)} MB total)`);
    console.log('  License: LGPL 2.1+ — https://ffmpeg.org/legal.html');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error(`\nfetch-ffmpeg failed: ${err.message}`);
  process.exit(1);
});
