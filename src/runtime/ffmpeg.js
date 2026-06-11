const { spawnSync } = require('child_process');

function installHint() {
  if (process.platform === 'win32') {
    return 'Install FFmpeg with: winget install Gyan.FFmpeg, then reopen Paperweight.';
  }
  if (process.platform === 'darwin') {
    return 'Install FFmpeg with: brew install ffmpeg, then restart Paperweight.';
  }
  return 'Install FFmpeg with your package manager, for example: sudo apt install ffmpeg, then restart Paperweight.';
}

function commandVersion(name) {
  try {
    const result = spawnSync(name, ['-version'], {
      stdio: 'pipe',
      windowsHide: true,
      timeout: 3000,
      encoding: 'utf8',
    });
    if (result.status !== 0) return null;
    return String(result.stdout || '').split(/\r?\n/)[0] || `${name} found`;
  } catch {
    return null;
  }
}

function getFFmpegStatus() {
  const ffmpeg = commandVersion('ffmpeg');
  const ffprobe = commandVersion('ffprobe');
  const missing = [];
  if (!ffmpeg) missing.push('ffmpeg');
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

module.exports = { commandVersion, getFFmpegStatus, installHint };
