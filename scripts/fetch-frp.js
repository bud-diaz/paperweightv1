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
const VERSION = '0.65.0';

const SOURCES = Object.freeze({
  'win32-x64': { url: `https://github.com/fatedier/frp/releases/download/v${VERSION}/frp_${VERSION}_windows_amd64.zip`, format: 'zip', dir: `frp_${VERSION}_windows_amd64`, bin: 'frpc.exe' },
  'linux-x64': { url: `https://github.com/fatedier/frp/releases/download/v${VERSION}/frp_${VERSION}_linux_amd64.tar.gz`, format: 'tgz', dir: `frp_${VERSION}_linux_amd64`, bin: 'frpc' },
  'linux-arm64': { url: `https://github.com/fatedier/frp/releases/download/v${VERSION}/frp_${VERSION}_linux_arm64.tar.gz`, format: 'tgz', dir: `frp_${VERSION}_linux_arm64`, bin: 'frpc' },
  'darwin-x64': { url: `https://github.com/fatedier/frp/releases/download/v${VERSION}/frp_${VERSION}_darwin_amd64.tar.gz`, format: 'tgz', dir: `frp_${VERSION}_darwin_amd64`, bin: 'frpc' },
  'darwin-arm64': { url: `https://github.com/fatedier/frp/releases/download/v${VERSION}/frp_${VERSION}_darwin_arm64.tar.gz`, format: 'tgz', dir: `frp_${VERSION}_darwin_arm64`, bin: 'frpc' },
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
  return path.join(destDir, platform === 'win32' ? 'frpc.exe' : 'frpc');
}

async function fetchFrp(options = {}) {
  const platform = options.platform || process.platform;
  const arch = options.arch || process.arch;
  const key = `${platform}-${arch}`;
  const source = SOURCES[key];
  if (!source) throw new Error(`No FRP source configured for ${key}`);

  const destDir = path.resolve(options.dest || path.join(ROOT, 'vendor', 'frp'));
  const destination = targetPath(platform, destDir);
  if (!options.force && fs.existsSync(destination)) {
    console.log(`frpc already cached for ${key} at ${destDir}.`);
    return { frpc: destination, platform, arch, destDir, cached: true };
  }

  fs.mkdirSync(destDir, { recursive: true });
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-frp-'));

  try {
    console.log(`Fetching frpc ${VERSION} for ${key}...`);
    const archive = path.join(tempDir, source.format === 'zip' ? 'frp.zip' : 'frp.tar.gz');
    await downloadToFile(source.url, archive);
    const extracted = path.join(tempDir, 'extracted');
    fs.mkdirSync(extracted);
    if (source.format === 'zip') {
      run('unzip', ['-q', archive, '-d', extracted]);
    } else {
      run('tar', ['-xzf', archive, '-C', extracted]);
    }
    fs.copyFileSync(path.join(extracted, source.dir, source.bin), destination);
    if (platform !== 'win32') fs.chmodSync(destination, 0o755);
    return { frpc: destination, platform, arch, destDir, cached: false };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  fetchFrp(parseOptions(process.argv.slice(2))).catch(err => {
    console.error(`fetch-frp failed: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { SOURCES, VERSION, fetchFrp, targetPath };
