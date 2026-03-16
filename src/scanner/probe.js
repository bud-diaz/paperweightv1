const { spawn } = require('child_process');
const path = require('path');

const SUPPORTED_EXTENSIONS = new Set([
  '.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a', '.aiff', '.opus',
  '.mp4', '.mov', '.mkv', '.avi', '.webm', '.m4v',
]);

function isSupported(filepath) {
  return SUPPORTED_EXTENSIONS.has(path.extname(filepath).toLowerCase());
}

function guessMimeType(formatName) {
  if (!formatName) return 'application/octet-stream';
  const f = formatName.toLowerCase();
  if (f.includes('mp3') || f.includes('mpeg')) return 'audio/mpeg';
  if (f.includes('wav') || f.includes('pcm')) return 'audio/wav';
  if (f.includes('flac')) return 'audio/flac';
  if (f.includes('aac') || f.includes('adts')) return 'audio/aac';
  if (f.includes('ogg')) return 'audio/ogg';
  if (f.includes('m4a') || f.includes('ipod')) return 'audio/mp4';
  if (f.includes('mp4') || f.includes('mov')) return 'video/mp4';
  if (f.includes('matroska') || f.includes('mkv')) return 'video/x-matroska';
  if (f.includes('avi')) return 'video/x-msvideo';
  if (f.includes('webm')) return 'video/webm';
  return 'application/octet-stream';
}

function extractMetadata(raw) {
  const format = raw.format || {};
  const tags = format.tags || {};
  const streams = raw.streams || [];

  // Check if it has video stream (excludes album art streams)
  const hasVideo = streams.some(s =>
    s.codec_type === 'video' &&
    s.codec_name !== 'mjpeg' &&
    s.codec_name !== 'png' &&
    s.codec_name !== 'bmp'
  );

  return {
    duration: parseFloat(format.duration) || null,
    title: tags.title || tags.TITLE || null,
    artist: tags.artist || tags.ARTIST || null,
    album: tags.album || tags.ALBUM || null,
    bpm: parseFloat(tags.BPM || tags.bpm || tags.TBPM || tags.tbpm) || null,
    mime_type: guessMimeType(format.format_name),
    file_size: parseInt(format.size, 10) || null,
    hasVideo,
  };
}

function probe(filepath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filepath,
    ];

    const proc = spawn('ffprobe', args);
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', d => { stdout += d; });
    proc.stderr.on('data', d => { stderr += d; });

    proc.on('error', err => {
      if (err.code === 'ENOENT') {
        reject(new Error('ffprobe not found. Install ffmpeg: sudo apt install ffmpeg'));
      } else {
        reject(err);
      }
    });

    proc.on('close', code => {
      if (code !== 0) {
        return reject(new Error(`ffprobe exited ${code} for: ${filepath}`));
      }
      try {
        const raw = JSON.parse(stdout);
        resolve(extractMetadata(raw));
      } catch (e) {
        reject(new Error(`Failed to parse ffprobe output for: ${filepath}`));
      }
    });
  });
}

module.exports = { probe, isSupported };
