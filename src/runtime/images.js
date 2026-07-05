const fs = require('fs');

const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const IMAGE_EXTS = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

function detectImageMime(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 8
    && buffer[0] === 0x89
    && buffer[1] === 0x50
    && buffer[2] === 0x4e
    && buffer[3] === 0x47
    && buffer[4] === 0x0d
    && buffer[5] === 0x0a
    && buffer[6] === 0x1a
    && buffer[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (
    buffer.length >= 12
    && buffer.slice(0, 4).toString('ascii') === 'RIFF'
    && buffer.slice(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (
    buffer.length >= 6
    && (buffer.slice(0, 6).toString('ascii') === 'GIF87a'
      || buffer.slice(0, 6).toString('ascii') === 'GIF89a')
  ) {
    return 'image/gif';
  }
  return null;
}

function sniffImageFile(filepath) {
  const fd = fs.openSync(filepath, 'r');
  try {
    const buffer = Buffer.alloc(16);
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
    return detectImageMime(buffer.subarray(0, bytesRead));
  } finally {
    fs.closeSync(fd);
  }
}

function setImageHeaders(res, mime, cacheControl = 'public, max-age=3600') {
  res.setHeader('Content-Type', mime);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', cacheControl);
}

module.exports = {
  IMAGE_MIMES,
  IMAGE_EXTS,
  detectImageMime,
  sniffImageFile,
  setImageHeaders,
};
