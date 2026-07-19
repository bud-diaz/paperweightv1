'use strict';

// Generates the iOS AppIcon.appiconset from the Paperweight logo with no
// external image-processing dependency — same pure-Node PNG approach as
// electron/scripts/generate-icons.js, adapted for iOS's modern single-size
// app icon (Xcode 14+ generates every device size from one 1024x1024 source).
// Writes to ios-app/build/AppIcon.appiconset/ rather than directly into the
// Xcode project, since `ios/` only exists after `npx cap add ios` has run on
// a Mac — copy the generated folder over
// ios-app/ios/App/App/Assets.xcassets/AppIcon.appiconset/ afterward.
//
// Apple requires the App Store marketing icon to have no alpha channel, so
// (unlike the Electron generator, which always emits RGBA) this writes a
// straight RGB PNG.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..', '..');
const SOURCE_LOGO = path.join(ROOT, 'assets', 'branding', 'pape-logo-yt.png');
const OUT_DIR = path.join(__dirname, '..', 'build', 'AppIcon.appiconset');
const ICON_SIZE = 1024;
// Matches the filename Capacitor's default `cap add ios` template already
// uses for its placeholder AppIcon.appiconset, so copying this folder over
// ios/App/App/Assets.xcassets/AppIcon.appiconset/ is a straight overwrite —
// no Contents.json filename mismatch to reconcile by hand.
const ICON_FILENAME = 'AppIcon-512@2x.png';

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

function encodePngRgb(pixelsRgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // color type 2 = truecolor, no alpha
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = size * 3;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0;
    for (let x = 0; x < size; x += 1) {
      const src = (y * size + x) * 4;
      const dst = y * (stride + 1) + 1 + x * 3;
      raw[dst] = pixelsRgba[src];
      raw[dst + 1] = pixelsRgba[src + 1];
      raw[dst + 2] = pixelsRgba[src + 2];
    }
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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function samplePixel(image, x, y) {
  const sx = clamp(Math.floor(x), 0, image.width - 1);
  const sy = clamp(Math.floor(y), 0, image.height - 1);
  const i = (sy * image.width + sx) * 4;
  return [
    image.pixels[i],
    image.pixels[i + 1],
    image.pixels[i + 2],
    image.pixels[i + 3],
  ];
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

function renderAppIcon(source, bounds, size) {
  // No rounded-corner mask and no alpha: iOS applies its own corner mask at
  // render time and the App Store rejects marketing icons with transparency.
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
      out[i + 3] = 255;

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

const CONTENTS_JSON = {
  images: [
    {
      filename: ICON_FILENAME,
      idiom: 'universal',
      platform: 'ios',
      size: '1024x1024',
    },
  ],
  info: { author: 'xcode', version: 1 },
};

function main() {
  const source = decodePng(SOURCE_LOGO);
  const bounds = alphaBounds(source);
  const pixels = renderAppIcon(source, bounds, ICON_SIZE);
  const png = encodePngRgb(pixels, ICON_SIZE);

  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, ICON_FILENAME), png);
  fs.writeFileSync(path.join(OUT_DIR, 'Contents.json'), JSON.stringify(CONTENTS_JSON, null, 2) + '\n');

  console.log(`[Paperweight] Generated ${path.relative(ROOT, OUT_DIR)} from ${path.relative(ROOT, SOURCE_LOGO)}`);
  console.log('Copy this folder over ios-app/ios/App/App/Assets.xcassets/AppIcon.appiconset/ after `npx cap add ios`.');
}

if (require.main === module) {
  main();
}

module.exports = { main };
