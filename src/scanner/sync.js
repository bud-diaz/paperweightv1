const fs = require('fs');
const path = require('path');
const { getDb, log } = require('../db');

const upsertStmt = `
  INSERT INTO media (
    filepath, filename, category, title, artist, album,
    duration, bpm, tags, file_size, mime_type, updated_at
  ) VALUES (
    :filepath, :filename, :category, :title, :artist, :album,
    :duration, :bpm, :tags, :file_size, :mime_type, datetime('now')
  )
  ON CONFLICT(filepath) DO UPDATE SET
    filename   = excluded.filename,
    category   = excluded.category,
    title      = excluded.title,
    artist     = excluded.artist,
    album      = excluded.album,
    duration   = excluded.duration,
    bpm        = excluded.bpm,
    tags       = excluded.tags,
    file_size  = excluded.file_size,
    mime_type  = excluded.mime_type,
    updated_at = excluded.updated_at,
    is_active  = 1
`;

// Returns true if the file needs to be (re-)probed.
// Skips re-probe if the DB record is newer than the file's mtime.
function needsProbe(filepath) {
  const db = getDb();
  const row = db.prepare(
    "SELECT updated_at FROM media WHERE filepath = ? AND is_active = 1"
  ).get(path.resolve(filepath));

  if (!row) return true;

  try {
    const stat = fs.statSync(filepath);
    const mtime = stat.mtime.toISOString().replace('T', ' ').slice(0, 19);
    return mtime > row.updated_at;
  } catch {
    return true;
  }
}

function upsert(filepath, category, probeData) {
  const db = getDb();
  db.prepare(upsertStmt).run({
    filepath: path.resolve(filepath),
    filename: path.basename(filepath),
    category,
    title: probeData.title || null,
    artist: probeData.artist || null,
    album: probeData.album || null,
    duration: probeData.duration || null,
    bpm: probeData.bpm || null,
    tags: null,
    file_size: probeData.file_size || null,
    mime_type: probeData.mime_type || null,
  });
}

function markInactive(filepath) {
  const db = getDb();
  db.prepare(
    "UPDATE media SET is_active = 0, updated_at = datetime('now') WHERE filepath = ?"
  ).run(path.resolve(filepath));
  log('info', 'scanner', `Marked inactive: ${path.basename(filepath)}`);
}

module.exports = { needsProbe, upsert, markInactive };
