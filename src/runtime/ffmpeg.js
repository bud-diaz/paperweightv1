'use strict';

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const isPackaged = typeof process.pkg !== 'undefined';

const FFMPEG_BIN  = process.platform === 'win32' ? 'ffmpeg.exe'  : 'ffmpeg';
const FFPROBE_BIN = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';

let ffmpegPath  = 'ffmpeg';
let ffprobePath = 'ffprobe';

if (isPackaged) {
  const dataRoot   = path.dirname(process.execPath);
  const binDir     = path.join(dataRoot, 'bin');
  const ffmpegDest  = path.join(binDir, FFMPEG_BIN);
  const ffprobeDest = path.join(binDir, FFPROBE_BIN);

  if (!fs.existsSync(ffmpegDest) || !fs.existsSync(ffprobeDest)) {
    const bundledFfmpeg  = path.join(__dirname, '../../vendor/ffmpeg', FFMPEG_BIN);
    const bundledFfprobe = path.join(__dirname, '../../vendor/ffmpeg', FFPROBE_BIN);

    try {
      fs.mkdirSync(binDir, { recursive: true });

      const ffmpegData  = fs.readFileSync(bundledFfmpeg);
      const ffprobeData = fs.readFileSync(bundledFfprobe);
      fs.writeFileSync(ffmpegDest,  ffmpegData,  { mode: 0o755 });
      fs.writeFileSync(ffprobeDest, ffprobeData, { mode: 0o755 });

      console.log(`[Paperweight] Extracted FFmpeg to ${binDir}`);
    } catch (err) {
      console.warn(`[Paperweight] Could not extract bundled FFmpeg: ${err.message}`);
    }
  }

  if (fs.existsSync(ffmpegDest))  ffmpegPath  = ffmpegDest;
  if (fs.existsSync(ffprobeDest)) ffprobePath = ffprobeDest;
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
