'use strict';

// Generates minimal placeholder app icons (electron/build/icon.ico,
// electron/build/icon.icns) with zero external dependencies, since no
// image-processing tooling (ImageMagick, sharp, PIL) is available in this
// environment. Produces a flat navy square with a lighter "P" monogram,
// encoded as a single raw PNG payload embedded directly in each container
// format — both ICO (Vista+) and ICNS (10.7+) accept PNG-compressed icon
// images natively, so no bitmap/run-length conversion is needed.
// Replace with real branded artwork before a real release.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 256;
const BG = [0x1f, 0x2a, 0x44]; // navy
const FG = [0xe8, 0xc4, 0x5e]; // gold

// 5x7 monogram "P" bitmap, scaled up and centered.
const GLYPH = [
  '11110',
  '10001',
  '10001',
  '11110',
  '10000',
  '10000',
  '10000',
].map(row => row.split('').map(Number));

function buildPixels() {
  const pixels = Buffer.alloc(SIZE * SIZE * 4);
  const scale = 24;
  const glyphW = GLYPH[0].length * scale;
  const glyphH = GLYPH.length * scale;
  const offX = Math.floor((SIZE - glyphW) / 2);
  const offY = Math.floor((SIZE - glyphH) / 2);

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let color = BG;
      const gx = x - offX;
      const gy = y - offY;
      if (gx >= 0 && gx < glyphW && gy >= 0 && gy < glyphH) {
        if (GLYPH[Math.floor(gy / scale)][Math.floor(gx / scale)] === 1) {
          color = FG;
        }
      }
      const i = (y * SIZE + x) * 4;
      pixels[i] = color[0];
      pixels[i + 1] = color[1];
      pixels[i + 2] = color[2];
      pixels[i + 3] = 0xff;
    }
  }
  return pixels;
}

function crc32(buf) {
  let crc = ~0;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
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
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const idat = zlib.deflateSync(raw);

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function resizeNearest(pixels, srcSize, dstSize) {
  if (srcSize === dstSize) return pixels;
  const out = Buffer.alloc(dstSize * dstSize * 4);
  for (let y = 0; y < dstSize; y++) {
    const sy = Math.min(srcSize - 1, Math.floor((y * srcSize) / dstSize));
    for (let x = 0; x < dstSize; x++) {
      const sx = Math.min(srcSize - 1, Math.floor((x * srcSize) / dstSize));
      const si = (sy * srcSize + sx) * 4;
      const di = (y * dstSize + x) * 4;
      pixels.copy(out, di, si, si + 4);
    }
  }
  return out;
}

function buildIco(pngBySizeAsc) {
  const count = pngBySizeAsc.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(count, 4);

  const entries = [];
  const images = [];
  let offset = 6 + 16 * count;
  for (const { size, png } of pngBySizeAsc) {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size; // 0 means 256
    entry[1] = size >= 256 ? 0 : size;
    entry[2] = 0;
    entry[3] = 0;
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    images.push(png);
    offset += png.length;
  }
  return Buffer.concat([header, ...entries, ...images]);
}

function buildIcns(entries) {
  // entries: [{ type: 'ic07', png }, ...] — modern ICNS types accept raw PNG data.
  const chunks = entries.map(({ type, png }) => {
    const len = 8 + png.length;
    const head = Buffer.alloc(8);
    head.write(type, 0, 'ascii');
    head.writeUInt32BE(len, 4);
    return Buffer.concat([head, png]);
  });
  const body = Buffer.concat(chunks);
  const totalLen = 8 + body.length;
  const header = Buffer.alloc(8);
  header.write('icns', 0, 'ascii');
  header.writeUInt32BE(totalLen, 4);
  return Buffer.concat([header, body]);
}

function main() {
  const buildDir = path.resolve(__dirname, '..', 'build');
  fs.mkdirSync(buildDir, { recursive: true });

  const basePixels = buildPixels();

  const icoSizes = [16, 32, 48, 256];
  const icoPngs = icoSizes.map(size => ({
    size,
    png: encodePng(resizeNearest(basePixels, SIZE, size), size),
  }));
  fs.writeFileSync(path.join(buildDir, 'icon.ico'), buildIco(icoPngs));

  const icnsMap = [
    { type: 'icp4', size: 16 },
    { type: 'icp5', size: 32 },
    { type: 'icp6', size: 64 },
    { type: 'ic07', size: 128 },
    { type: 'ic08', size: 256 },
  ];
  const icnsEntries = icnsMap.map(({ type, size }) => ({
    type,
    png: encodePng(resizeNearest(basePixels, SIZE, size), size),
  }));
  fs.writeFileSync(path.join(buildDir, 'icon.icns'), buildIcns(icnsEntries));

  // Small flat PNG for the system tray (nativeImage.createFromPath wants a
  // plain raster image here, not an .ico/.icns container).
  fs.writeFileSync(path.join(buildDir, 'tray-icon.png'), encodePng(resizeNearest(basePixels, SIZE, 32), 32));

  console.log(`[Paperweight] Wrote placeholder icons to ${buildDir}`);
}

main();
