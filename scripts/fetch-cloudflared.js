#!/usr/bin/env node
'use strict';

const https = require('https');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const zlib = require('zlib');
const { spawnSync } = require('child_process');
const { parseOptions } = require('./lib/binary-target');

const ROOT = path.resolve(__dirname, '..');

// cloudflared publishes a single static binary per platform/arch as a GitHub
// release asset (macOS ships it inside a .tgz instead of raw). The
// `releases/latest/download/<asset>` alias always resolves to the newest
// release, so no version tag needs to be tracked/bumped here (unlike
// fetch-ffmpeg.js's darwin sources, which pin an exact ffmpeg-static tag).
const SOURCES = Object.freeze({
  'win32-x64': { url: 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe', format: 'raw' },
  'linux-x64': { url: 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64', format: 'raw' },
  'linux-arm64': { url: 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64', format: 'raw' },
  'darwin-x64': { url: 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64.tgz', format: 'tgz' },
  'darwin-arm64': { url: 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64.tgz', format: 'tgz' },
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

function targetPath(platform, destDir) {
  return path.join(destDir, platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
}

async function fetchCloudflared(options = {}) {
  const platform = options.platform || process.platform;
  const arch = options.arch || process.arch;
  const key = `${platform}-${arch}`;
  const source = SOURCES[key];
  if (!source) throw new Error(`No cloudflared source configured for ${key}`);

  const destDir = path.resolve(options.dest || path.join(ROOT, 'vendor', 'cloudflared'));
  const destination = targetPath(platform, destDir);
  if (!options.force && fs.existsSync(destination)) {
    console.log(`cloudflared already cached for ${key} at ${destDir}.`);
    return { cloudflared: destination, platform, arch, destDir, cached: true };
  }

  fs.mkdirSync(destDir, { recursive: true });
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-cloudflared-'));

  try {
    console.log(`Fetching cloudflared for ${key}...`);
    if (source.format === 'tgz') {
      const archive = path.join(tempDir, 'cloudflared.tgz');
      await downloadToFile(source.url, archive);
      const extracted = path.join(tempDir, 'extracted');
      fs.mkdirSync(extracted);
      run('tar', ['-xzf', archive, '-C', extracted]);
      fs.copyFileSync(path.join(extracted, 'cloudflared'), destination);
    } else {
      await downloadToFile(source.url, destination);
    }
    if (platform !== 'win32') fs.chmodSync(destination, 0o755);
    return { cloudflared: destination, platform, arch, destDir, cached: false };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  fetchCloudflared(parseOptions(process.argv.slice(2))).catch(err => {
    console.error(`fetch-cloudflared failed: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { SOURCES, fetchCloudflared, targetPath };
