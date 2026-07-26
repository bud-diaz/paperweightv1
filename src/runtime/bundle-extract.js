'use strict';

// Shared extraction logic for pkg-bundled binaries embedded (gzip+base64) in
// a generated JS module — used by src/runtime/ffmpeg.js and
// src/runtime/cloudflared.js. pkg's asset globs are broken for node20
// targets, so these binaries ship as embedded module data instead of files.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function entryBuffer(entry) {
  if (Buffer.isBuffer(entry.data)) return entry.data;
  if (Array.isArray(entry.data)) return Buffer.from(entry.data.join(''), 'base64');
  if (typeof entry.data === 'string') return Buffer.from(entry.data, 'base64');
  throw new Error(`invalid bundle data for ${entry.filename || 'binary'}`);
}

function entryIsCompressed(entry) {
  return entry.compressed === true || entry.compression === 'gzip';
}

function entryRawBuffer(entry) {
  const data = entryBuffer(entry);
  return entryIsCompressed(entry) ? zlib.gunzipSync(data) : data;
}

function needsExtract(dest, entry) {
  if (!fs.existsSync(dest)) return true;
  if (!entry.sha256) return false;
  try {
    const raw = entryRawBuffer(entry);
    return sha256(fs.readFileSync(dest)) !== sha256(raw);
  } catch {
    return true;
  }
}

function extractEntry(entry, dest) {
  const raw = entryRawBuffer(entry);
  if (entry.sha256 && sha256(raw) !== entry.sha256) {
    throw new Error(`hash mismatch for ${path.basename(dest)}`);
  }
  fs.writeFileSync(dest, raw, { mode: 0o755 });
}

// Extracts `entry` to `dest` only if missing/stale, creating dest's parent
// directory as needed. Returns true if dest exists (whether just extracted or
// already current) after the attempt, false if extraction failed.
function ensureExtracted(entry, dest) {
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (needsExtract(dest, entry)) extractEntry(entry, dest);
    return fs.existsSync(dest);
  } catch {
    return false;
  }
}

module.exports = { sha256, entryBuffer, entryIsCompressed, entryRawBuffer, needsExtract, extractEntry, ensureExtracted };
