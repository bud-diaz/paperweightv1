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
// macOS has no BtbN-equivalent single-archive build with both ffmpeg and
// ffprobe, so darwin sources compose two independently-maintained, widely
// used static-binary projects instead: ffmpeg from eugeneware/ffmpeg-static's
// GitHub release assets (gzip-compressed single binary), and ffprobe from the
// ffprobe-static npm package, which bundles every platform's binary directly
// inside its npm tarball rather than via GitHub releases. Note: as of
// ffprobe-static@3.1.0 the published "darwin/arm64" binary is actually an
// x86_64 build (verified by inspecting it), so ffprobe runs under Rosetta 2
// on Apple Silicon rather than natively — ffmpeg itself is genuinely arm64.
// Bump FFPROBE_STATIC_TARBALL's version if a future release ships true arm64.
const FFPROBE_STATIC_TARBALL = 'https://registry.npmjs.org/ffprobe-static/-/ffprobe-static-3.1.0.tgz';
const FFMPEG_STATIC_RELEASE = 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1';

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
  'darwin-x64': {
    format: 'darwin-composite',
    ffmpegUrl: `${FFMPEG_STATIC_RELEASE}/ffmpeg-darwin-x64.gz`,
    ffprobeTarballUrl: FFPROBE_STATIC_TARBALL,
    ffprobeTarPath: 'package/bin/darwin/x64/ffprobe',
  },
  'darwin-arm64': {
    format: 'darwin-composite',
    ffmpegUrl: `${FFMPEG_STATIC_RELEASE}/ffmpeg-darwin-arm64.gz`,
    ffprobeTarballUrl: FFPROBE_STATIC_TARBALL,
    ffprobeTarPath: 'package/bin/darwin/arm64/ffprobe',
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
  const extracted = path.join(tempDir, 'extracted');
  fs.mkdirSync(extracted);
  const archive = source.url ? path.join(tempDir, path.basename(source.url)) : null;

  try {
    console.log(`Fetching FFmpeg for ${key}...`);

    if (source.format === 'darwin-composite') {
      const ffmpegGz = path.join(tempDir, 'ffmpeg.gz');
      await downloadToFile(source.ffmpegUrl, ffmpegGz);
      fs.writeFileSync(destinations.ffmpeg, zlib.gunzipSync(fs.readFileSync(ffmpegGz)));

      const ffprobeTarball = path.join(tempDir, 'ffprobe-static.tgz');
      await downloadToFile(source.ffprobeTarballUrl, ffprobeTarball);
      run('tar', ['-xzf', ffprobeTarball, '-C', extracted, source.ffprobeTarPath]);
      fs.copyFileSync(path.join(extracted, source.ffprobeTarPath), destinations.ffprobe);

      fs.chmodSync(destinations.ffmpeg, 0o755);
      fs.chmodSync(destinations.ffprobe, 0o755);
      return { ...destinations, platform, arch, destDir, cached: false };
    }

    await downloadToFile(source.url, archive);
    if (source.format === 'zip') {
      if (process.platform === 'win32') {
        // Trailing args after a bare -Command string are NOT bound to $args;
        // that only happens for a script block invoked with &. Without the
        // & { param(...) } wrapper, $args[0]/[1] are empty, so Expand-Archive
        // gets a null -LiteralPath.
        run('powershell.exe', ['-NoProfile', '-Command', '& { param($a, $b) Expand-Archive -LiteralPath $a -DestinationPath $b -Force }', archive, extracted]);
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
