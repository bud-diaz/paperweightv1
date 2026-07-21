#!/usr/bin/env node
'use strict';

const https = require('https');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
const { parseOptions } = require('./lib/binary-target');

const ROOT = path.resolve(__dirname, '..');
const SOURCES = Object.freeze({
  'win32-x64': {
    url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-lgpl.zip',
    format: 'zip',
    binDir: 'ffmpeg-master-latest-win64-lgpl/bin',
  },
  'linux-x64': {
    url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-lgpl.tar.xz',
    format: 'tar.xz',
    binDir: 'ffmpeg-master-latest-linux64-lgpl/bin',
  },
  'linux-arm64': {
    url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linuxarm64-lgpl.tar.xz',
    format: 'tar.xz',
    binDir: 'ffmpeg-master-latest-linuxarm64-lgpl/bin',
  },
});

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', cwd: ROOT, windowsHide: true });
  if (result.status !== 0) throw new Error(`${command} failed (exit ${result.status ?? 'unknown'})`);
}

function downloadToFile(url, dest) {
  return new Promise((resolve, reject) => {
    function get(targetUrl, redirects) {
      if (redirects > 8) return reject(new Error('Too many redirects'));
      const transport = targetUrl.startsWith('https:') ? https : http;
      transport.get(targetUrl, response => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          response.resume();
          get(new URL(response.headers.location, targetUrl).toString(), redirects + 1);
          return;
        }
        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`HTTP ${response.statusCode} fetching ${targetUrl}`));
          return;
        }
        const file = fs.createWriteStream(dest);
        response.pipe(file);
        response.on('error', reject);
        file.on('error', reject);
        file.on('finish', () => file.close(resolve));
      }).on('error', reject);
    }
    get(url, 0);
  });
}

function targetPaths(platform, destDir) {
  const suffix = platform === 'win32' ? '.exe' : '';
  return {
    ffmpeg: path.join(destDir, `ffmpeg${suffix}`),
    ffprobe: path.join(destDir, `ffprobe${suffix}`),
  };
}

async function fetchFfmpeg(options = {}) {
  const platform = options.platform || process.platform;
  const arch = options.arch || process.arch;
  const key = `${platform}-${arch}`;
  const source = SOURCES[key];
  if (!source) throw new Error(`No FFmpeg source configured for ${key}`);

  const destDir = path.resolve(options.dest || path.join(ROOT, 'vendor', 'ffmpeg'));
  const destinations = targetPaths(platform, destDir);
  if (!options.force && fs.existsSync(destinations.ffmpeg) && fs.existsSync(destinations.ffprobe)) {
    console.log(`FFmpeg already cached for ${key} at ${destDir}.`);
    return { ...destinations, platform, arch, destDir, cached: true };
  }

  fs.mkdirSync(destDir, { recursive: true });
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-ffmpeg-'));
  const archive = path.join(tempDir, path.basename(source.url));
  const extracted = path.join(tempDir, 'extracted');
  fs.mkdirSync(extracted);

  try {
    console.log(`Fetching FFmpeg for ${key}...`);
    await downloadToFile(source.url, archive);
    if (source.format === 'zip') {
      if (process.platform === 'win32') {
        run('powershell.exe', ['-NoProfile', '-Command', 'Expand-Archive -LiteralPath $args[0] -DestinationPath $args[1] -Force', archive, extracted]);
      } else {
        run('unzip', ['-q', archive, '-d', extracted]);
      }
    } else {
      run('tar', ['-xJf', archive, '-C', extracted]);
    }

    const suffix = platform === 'win32' ? '.exe' : '';
    fs.copyFileSync(path.join(extracted, source.binDir, `ffmpeg${suffix}`), destinations.ffmpeg);
    fs.copyFileSync(path.join(extracted, source.binDir, `ffprobe${suffix}`), destinations.ffprobe);
    if (platform !== 'win32') {
      fs.chmodSync(destinations.ffmpeg, 0o755);
      fs.chmodSync(destinations.ffprobe, 0o755);
    }
    return { ...destinations, platform, arch, destDir, cached: false };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  fetchFfmpeg(parseOptions(process.argv.slice(2))).catch(err => {
    console.error(`fetch-ffmpeg failed: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { SOURCES, fetchFfmpeg, targetPaths };
