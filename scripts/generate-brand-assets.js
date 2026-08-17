#!/usr/bin/env node
// Regenerates client/brand-mark.png (transparent header-logo cutout) and
// client/favicon.png / landing/favicon.png (dark-card favicon) from
// client/icon.png. No image-processing dependency — same hand-rolled PNG
// codec approach as electron/scripts/generate-icons.js.
//
// client/icon.png has a flat pure-black background and a white/gray-shaded
// mark with no alpha channel, so transparency is derived from luminance: a
// narrow low/high threshold band covers the anti-aliased edge, everything
// below it becomes fully transparent (background) and everything above it
// stays fully opaque (preserving the mark's gray bevel shading untouched).
//
// Run whenever client/icon.png changes:
//   node scripts/generate-brand-assets.js

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'client', 'icon.png');
const BRAND_MARK_OUT = path.join(ROOT, 'client', 'brand-mark.png');
const FAVICON_OUTS = [
  path.join(ROOT, 'client', 'favicon.png'),
  path.join(ROOT, 'landing', 'favicon.png'),
];

const BRAND_MARK_SIZE = 512;
const BRAND_MARK_CONTENT_HEIGHT_RATIO = 0.9277; // matches the previous brand-mark.png's crop/padding
const FAVICON_SIZE = 128;
const ALPHA_THRESHOLD_LOW = 10;
const ALPHA_THRESHOLD_HIGH = 120;

function fail(message) {
  throw new Error(message);
}

function crc32(buf) {
  let crc = ~0;
  for (let i = 0; i < buf.length; i += 1) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePng(pixels, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function bytesPerPixel(colorType) {
  if (colorType === 0) return 1;
  if (colorType === 2) return 3;
  if (colorType === 4) return 2;
  if (colorType === 6) return 4;
  fail(`Unsupported PNG color type ${colorType}`);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function unfilterPng(raw, width, height, bpp) {
  const stride = width * bpp;
  const out = Buffer.alloc(stride * height);
  let src = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = raw[src];
    src += 1;
    const row = y * stride;
    const prior = row - stride;

    for (let x = 0; x < stride; x += 1) {
      const value = raw[src + x];
      const left = x >= bpp ? out[row + x - bpp] : 0;
      const up = y > 0 ? out[prior + x] : 0;
      const upLeft = y > 0 && x >= bpp ? out[prior + x - bpp] : 0;
      let decoded;

      if (filter === 0) decoded = value;
      else if (filter === 1) decoded = value + left;
      else if (filter === 2) decoded = value + up;
      else if (filter === 3) decoded = value + Math.floor((left + up) / 2);
      else if (filter === 4) decoded = value + paeth(left, up, upLeft);
      else fail(`Unsupported PNG filter ${filter}`);

      out[row + x] = decoded & 0xff;
    }
    src += stride;
  }

  return out;
}

function decodePng(file) {
  const data = fs.readFileSync(file);
  if (data.length < 33 || data.slice(0, 8).compare(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) !== 0) {
    fail(`${file} is not a PNG file`);
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idats = [];

  while (offset < data.length) {
    const length = data.readUInt32BE(offset);
    const type = data.slice(offset + 4, offset + 8).toString('ascii');
    const payload = data.slice(offset + 8, offset + 8 + length);
    offset += 12 + length;

    if (type === 'IHDR') {
      width = payload.readUInt32BE(0);
      height = payload.readUInt32BE(4);
      bitDepth = payload[8];
      colorType = payload[9];
      interlace = payload[12];
    } else if (type === 'IDAT') {
      idats.push(payload);
    } else if (type === 'IEND') {
      break;
    }
  }

  if (bitDepth !== 8) fail(`${file} must be an 8-bit PNG`);
  if (interlace !== 0) fail(`${file} must be a non-interlaced PNG`);
  if (!width || !height || idats.length === 0) fail(`${file} is missing PNG image data`);

  const bpp = bytesPerPixel(colorType);
  const inflated = zlib.inflateSync(Buffer.concat(idats));
  const decoded = unfilterPng(inflated, width, height, bpp);
  const pixels = Buffer.alloc(width * height * 4);

  for (let i = 0, o = 0; i < decoded.length; i += bpp, o += 4) {
    if (colorType === 0) {
      pixels[o] = decoded[i];
      pixels[o + 1] = decoded[i];
      pixels[o + 2] = decoded[i];
      pixels[o + 3] = 0xff;
    } else if (colorType === 2) {
      pixels[o] = decoded[i];
      pixels[o + 1] = decoded[i + 1];
      pixels[o + 2] = decoded[i + 2];
      pixels[o + 3] = 0xff;
    } else if (colorType === 4) {
      pixels[o] = decoded[i];
      pixels[o + 1] = decoded[i];
      pixels[o + 2] = decoded[i];
      pixels[o + 3] = decoded[i + 1];
    } else if (colorType === 6) {
      pixels[o] = decoded[i];
      pixels[o + 1] = decoded[i + 1];
      pixels[o + 2] = decoded[i + 2];
      pixels[o + 3] = decoded[i + 3];
    }
  }

  return { width, height, pixels };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// The source has a flat black background with no real alpha channel, so
// derive one from brightness: a thin threshold band covers the existing
// anti-aliased edge, everything else is either fully transparent (bg) or
// fully opaque (mark, including its gray bevel shading).
function deriveAlphaFromLuminance(image, low, high) {
  for (let i = 0; i < image.pixels.length; i += 4) {
    const r = image.pixels[i];
    const g = image.pixels[i + 1];
    const b = image.pixels[i + 2];
    const brightness = Math.max(r, g, b);
    const alpha = clamp(Math.round(((brightness - low) / (high - low)) * 255), 0, 255);
    image.pixels[i + 3] = alpha;
  }
}

function alphaBounds(image) {
  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const alpha = image.pixels[(y * image.width + x) * 4 + 3];
      if (alpha <= 8) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < minX || maxY < minY) {
    return { x: 0, y: 0, width: image.width, height: image.height };
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

function samplePixel(image, x, y) {
  const sx = clamp(Math.floor(x), 0, image.width - 1);
  const sy = clamp(Math.floor(y), 0, image.height - 1);
  const i = (sy * image.width + sx) * 4;
  return [image.pixels[i], image.pixels[i + 1], image.pixels[i + 2], image.pixels[i + 3]];
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function sampleBilinear(image, x, y) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  const c00 = samplePixel(image, x0, y0);
  const c10 = samplePixel(image, x0 + 1, y0);
  const c01 = samplePixel(image, x0, y0 + 1);
  const c11 = samplePixel(image, x0 + 1, y0 + 1);
  const out = [];

  for (let i = 0; i < 4; i += 1) {
    const top = lerp(c00[i], c10[i], tx);
    const bottom = lerp(c01[i], c11[i], tx);
    out[i] = Math.round(lerp(top, bottom, ty));
  }

  return out;
}

// Renders the alpha-cut mark onto a fully transparent square canvas, scaled
// so the content fills `contentHeightRatio` of the canvas height and is
// centered — reproduces the previous brand-mark.png's crop/padding.
function renderTransparentCrop(source, bounds, size, contentHeightRatio) {
  const out = Buffer.alloc(size * size * 4);
  const scale = (size * contentHeightRatio) / bounds.height;
  const targetW = Math.max(1, Math.round(bounds.width * scale));
  const targetH = Math.max(1, Math.round(bounds.height * scale));
  const targetX = Math.floor((size - targetW) / 2);
  const targetY = Math.floor((size - targetH) / 2);

  for (let y = targetY; y < targetY + targetH; y += 1) {
    if (y < 0 || y >= size) continue;
    for (let x = targetX; x < targetX + targetW; x += 1) {
      if (x < 0 || x >= size) continue;
      const sx = bounds.x + ((x - targetX + 0.5) / targetW) * bounds.width;
      const sy = bounds.y + ((y - targetY + 0.5) / targetH) * bounds.height;
      const fg = sampleBilinear(source, sx, sy);
      const i = (y * size + x) * 4;
      out[i] = fg[0];
      out[i + 1] = fg[1];
      out[i + 2] = fg[2];
      out[i + 3] = fg[3];
    }
  }

  return out;
}

// Same dark-card treatment as electron/scripts/generate-icons.js's app icon
// background, which is what the previous favicon.png already used.
function backgroundAt(x, y, size) {
  const dx = (x - size * 0.5) / size;
  const dy = (y - size * 0.42) / size;
  const glow = clamp(1 - Math.sqrt(dx * dx + dy * dy) / 0.72, 0, 1);
  return [
    Math.round(12 + glow * 24),
    Math.round(17 + glow * 27),
    Math.round(24 + glow * 35),
    255,
  ];
}

function renderFavicon(source, bounds, size) {
  const out = Buffer.alloc(size * size * 4);
  const scale = Math.min((size * 0.76) / bounds.width, (size * 0.86) / bounds.height);
  const targetW = Math.max(1, Math.round(bounds.width * scale));
  const targetH = Math.max(1, Math.round(bounds.height * scale));
  const targetX = Math.floor((size - targetW) / 2);
  const targetY = Math.floor((size - targetH) / 2 + size * 0.025);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4;
      const bg = backgroundAt(x, y, size);
      out[i] = bg[0];
      out[i + 1] = bg[1];
      out[i + 2] = bg[2];
      out[i + 3] = bg[3];

      if (x < targetX || y < targetY || x >= targetX + targetW || y >= targetY + targetH) {
        continue;
      }

      const sx = bounds.x + ((x - targetX + 0.5) / targetW) * bounds.width;
      const sy = bounds.y + ((y - targetY + 0.5) / targetH) * bounds.height;
      const fg = sampleBilinear(source, sx, sy);
      const alpha = fg[3] / 255;
      out[i] = Math.round(fg[0] * alpha + out[i] * (1 - alpha));
      out[i + 1] = Math.round(fg[1] * alpha + out[i + 1] * (1 - alpha));
      out[i + 2] = Math.round(fg[2] * alpha + out[i + 2] * (1 - alpha));
    }
  }

  return out;
}

function main() {
  const source = decodePng(SOURCE);
  deriveAlphaFromLuminance(source, ALPHA_THRESHOLD_LOW, ALPHA_THRESHOLD_HIGH);
  const bounds = alphaBounds(source);

  const brandMarkPixels = renderTransparentCrop(source, bounds, BRAND_MARK_SIZE, BRAND_MARK_CONTENT_HEIGHT_RATIO);
  fs.writeFileSync(BRAND_MARK_OUT, encodePng(brandMarkPixels, BRAND_MARK_SIZE));
  console.log(`[Paperweight] Wrote ${path.relative(ROOT, BRAND_MARK_OUT)}`);

  const faviconPixels = renderFavicon(source, bounds, FAVICON_SIZE);
  const faviconPng = encodePng(faviconPixels, FAVICON_SIZE);
  for (const out of FAVICON_OUTS) {
    fs.writeFileSync(out, faviconPng);
    console.log(`[Paperweight] Wrote ${path.relative(ROOT, out)}`);
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
