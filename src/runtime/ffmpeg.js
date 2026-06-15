'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const zlib = require('zlib');
const { spawnSync } = require('child_process');

const isPackaged = typeof process.pkg !== 'undefined';

const FFMPEG_BIN  = process.platform === 'win32' ? 'ffmpeg.exe'  : 'ffmpeg';
const FFPROBE_BIN = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';

let ffmpegPath  = 'ffmpeg';
let ffprobePath = 'ffprobe';

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function fileMatches(filepath, expectedHash) {
  try {
    return fs.existsSync(filepath) && sha256(fs.readFileSync(filepath)) === expectedHash;
  } catch {
    return false;
  }
}

function readBundledBinary(entry, expectedFilename) {
  if (!entry || entry.filename !== expectedFilename) {
    throw new Error(`FFmpeg bundle entry mismatch for ${expectedFilename}`);
  }
  if (!Array.isArray(entry.data) || !entry.data.length) {
    throw new Error(`FFmpeg bundle entry has no data for ${expectedFilename}`);
  }

  const compressed = Buffer.from(entry.data.join(''), 'base64');
  if (entry.compressedSha256 && sha256(compressed) !== entry.compressedSha256) {
    throw new Error(`FFmpeg bundle compressed hash mismatch for ${expectedFilename}`);
  }

  const data = entry.compression === 'gzip' ? zlib.gunzipSync(compressed) : compressed;
  if (entry.size && data.length !== entry.size) {
    throw new Error(`FFmpeg bundle size mismatch for ${expectedFilename}`);
  }
  if (entry.sha256 && sha256(data) !== entry.sha256) {
    throw new Error(`FFmpeg bundle hash mismatch for ${expectedFilename}`);
  }

  return data;
}

function extractBundledBinary(entry, expectedFilename, dest) {
  if (entry?.sha256 && fileMatches(dest, entry.sha256)) {
    return false;
  }

  const data = readBundledBinary(entry, expectedFilename);
  fs.writeFileSync(dest, data, { mode: 0o755 });

  if (entry.sha256 && !fileMatches(dest, entry.sha256)) {
    throw new Error(`FFmpeg extraction hash verification failed for ${expectedFilename}`);
  }

  return true;
}

if (isPackaged) {
  const dataRoot   = path.dirname(process.execPath);
  const binDir     = path.join(dataRoot, 'bin');
  const ffmpegDest  = path.join(binDir, FFMPEG_BIN);
  const ffprobeDest = path.join(binDir, FFPROBE_BIN);

  try {
    const bundle = require('../ffmpeg-bundle');
    if (bundle.platform !== process.platform) {
      throw new Error(`platform mismatch: bundle=${bundle.platform || 'unknown'} runtime=${process.platform}`);
    }
    if (bundle.arch !== process.arch) {
      throw new Error(`architecture mismatch: bundle=${bundle.arch || 'unknown'} runtime=${process.arch}`);
    }

    fs.mkdirSync(binDir, { recursive: true });

    const extracted = [];
    if (extractBundledBinary(bundle.binaries?.ffmpeg, FFMPEG_BIN, ffmpegDest)) {
      extracted.push(FFMPEG_BIN);
    }
    if (extractBundledBinary(bundle.binaries?.ffprobe, FFPROBE_BIN, ffprobeDest)) {
      extracted.push(FFPROBE_BIN);
    }

    if (extracted.length) {
      console.log(`[Paperweight] Extracted bundled FFmpeg to ${binDir}: ${extracted.join(', ')}`);
    }
  } catch (err) {
    console.warn(`[Paperweight] Could not extract bundled FFmpeg: ${err.message}`);
  }

  if (fs.existsSync(ffmpegDest))  ffmpegPath  = ffmpegDest;
  if (fs.existsSync(ffprobeDest)) ffprobePath = ffprobeDest;
} else {
  const vendorDir = path.join(__dirname, '../../vendor/ffmpeg');
  const vendorFfmpeg = path.join(vendorDir, FFMPEG_BIN);
  const vendorFfprobe = path.join(vendorDir, FFPROBE_BIN);
  if (fs.existsSync(vendorFfmpeg))  ffmpegPath  = vendorFfmpeg;
  if (fs.existsSync(vendorFfprobe)) ffprobePath = vendorFfprobe;
}

function installHint() {
  if (isPackaged) {
    return 'FFmpeg could not be extracted from the bundle. Try reinstalling Paperweight.';
  }
  if (process.platform === 'win32') {
    return 'Install FFmpeg with: winget install Gyan.FFmpeg, then reopen Paperweight.';
  }
  if (process.platform === 'darwin') {
    return 'Install FFmpeg with: brew install ffmpeg, then restart Paperweight.';
  }
  return 'Install FFmpeg with your package manager, for example: sudo apt install ffmpeg, then restart Paperweight.';
}

function commandVersion(binPath) {
  try {
    const result = spawnSync(binPath, ['-version'], {
      stdio: 'pipe',
      windowsHide: true,
      timeout: 3000,
      encoding: 'utf8',
    });
    if (result.status !== 0) return null;
    return String(result.stdout || '').split(/\r?\n/)[0] || `${binPath} found`;
  } catch {
    return null;
  }
}

function getFFmpegStatus() {
  const ffmpeg  = commandVersion(ffmpegPath);
  const ffprobe = commandVersion(ffprobePath);
  const missing = [];
  if (!ffmpeg)  missing.push('ffmpeg');
  if (!ffprobe) missing.push('ffprobe');

  return {
    ok: missing.length === 0,
    ffmpeg,
    ffprobe,
    missing,
    message: missing.length
      ? `${missing.join(' and ')} not found. ${installHint()}`
      : 'FFmpeg and ffprobe are available.',
  };
}

module.exports = { ffmpegPath, ffprobePath, commandVersion, getFFmpegStatus, installHint };
