const fs = require('fs');
const path = require('path');
const { getDb, log } = require('../db');
const { probe } = require('./probe');

const upsertStmt = `
  INSERT INTO media (
    filepath, filename, category, title, artist, album, genre,
    duration, bpm, tags, file_size, mime_type, updated_at
  ) VALUES (
    :filepath, :filename, :category, :title, :artist, :album, :genre,
    :duration, :bpm, :tags, :file_size, :mime_type, datetime('now')
  )
  ON CONFLICT(filepath) DO UPDATE SET
    filename   = excluded.filename,
    category   = excluded.category,
    title      = excluded.title,
    artist     = excluded.artist,
    album      = excluded.album,
    genre      = excluded.genre,
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
    genre: probeData.genre || null,
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

function reconcileInactive() {
  const db = getDb();
  const missing = db.transaction(() => {
    const rows = db.prepare('SELECT filepath FROM media WHERE is_active = 1').all();
    const markMissing = db.prepare(
      "UPDATE media SET is_active = 0, updated_at = datetime('now') WHERE filepath = ?"
    );
    const removed = [];
    for (const { filepath } of rows) {
      if (!fs.existsSync(filepath)) {
        markMissing.run(filepath);
        removed.push(filepath);
      }
    }
    return removed;
  })();

  for (const filepath of missing) {
    log('info', 'scanner', `Reconciled missing file: ${path.basename(filepath)}`);
  }
  if (missing.length > 0) log('info', 'scanner', `Reconciliation complete: ${missing.length} file(s) marked inactive`);
}

// One-time repair for files scanned before the mp4/m4a mime-type fix: ffprobe
// reports the same format_name for the whole mov/mp4/m4a container family, so
// any row tagged audio/mp4 may actually be a video file that never got
// re-probed (needsProbe skips unchanged files). Re-probe those specifically
// and promote them to video/mp4 when they truly carry a video stream.
async function repairVideoMimeTypes() {
  const db = getDb();
  const rows = db.prepare(
    "SELECT filepath FROM media WHERE is_active = 1 AND mime_type = 'audio/mp4'"
  ).all();

  let fixed = 0;
  for (const { filepath } of rows) {
    try {
      const probeData = await probe(filepath);
      if (probeData.hasVideo && probeData.mime_type !== 'audio/mp4') {
        db.prepare(
          "UPDATE media SET mime_type = ?, updated_at = datetime('now') WHERE filepath = ?"
        ).run(probeData.mime_type, filepath);
        fixed++;
      }
    } catch (err) {
      log('error', 'scanner', `Failed to re-probe ${path.basename(filepath)}: ${err.message}`);
    }
  }
  if (fixed > 0) log('info', 'scanner', `Repaired mime_type for ${fixed} misclassified video file(s)`);
}

module.exports = { needsProbe, upsert, markInactive, reconcileInactive, repairVideoMimeTypes };
