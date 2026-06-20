const { getDb } = require('../db');

const BATCH_SIZE = 50;

// Weighted shuffle: tracks not played recently are pulled first.
// Falls back to RANDOM() as a tiebreaker so the order stays fresh.
function buildShuffleBatch({ category = null, count = BATCH_SIZE } = {}) {
  return getDb().prepare(`
    SELECT m.id, m.filepath, m.duration, m.title, m.artist, m.category, m.mime_type
    FROM media m
    LEFT JOIN (
      SELECT media_id, MAX(started_at) AS last_played
      FROM listen_events
      GROUP BY media_id
    ) le ON m.id = le.media_id
    WHERE m.is_active = 1
      AND m.visibility = 'public'
      AND (:category IS NULL OR m.category = :category)
    ORDER BY COALESCE(le.last_played, '1970-01-01') ASC, RANDOM()
    LIMIT :count
  `).all({ category: category || null, count });
}

// Sequential: ordered by playlist_items.position for a specific schedule block.
function buildSequentialBatch({ blockId, count = BATCH_SIZE } = {}) {
  return getDb().prepare(`
    SELECT m.id, m.filepath, m.duration, m.title, m.artist, m.category, m.mime_type
    FROM playlist_items pi
    JOIN media m ON m.id = pi.media_id
    WHERE pi.block_id = ?
      AND m.is_active = 1
      AND m.visibility = 'public'
    ORDER BY pi.position
    LIMIT ?
  `).all(blockId, count);
}

// Smart playlist: same recency-weighted shuffle as buildShuffleBatch, with an
// additional in-JS tag filter (every tag in tagsFilter must be present on the
// track) since this needs to stay independent of SQLite JSON1 availability.
function buildSmartPlaylistBatch({ category = null, tagsFilter = [], count = BATCH_SIZE } = {}) {
  const candidates = getDb().prepare(`
    SELECT m.id, m.filepath, m.duration, m.title, m.artist, m.category, m.mime_type, m.tags
    FROM media m
    LEFT JOIN (
      SELECT media_id, MAX(started_at) AS last_played
      FROM listen_events
      GROUP BY media_id
    ) le ON m.id = le.media_id
    WHERE m.is_active = 1
      AND m.visibility = 'public'
      AND (:category IS NULL OR m.category = :category)
    ORDER BY COALESCE(le.last_played, '1970-01-01') ASC, RANDOM()
  `).all({ category: category || null });

  if (!tagsFilter.length) return candidates.slice(0, count);

  const filtered = candidates.filter(row => {
    let mediaTags = [];
    try {
      const parsed = JSON.parse(row.tags || '[]');
      mediaTags = Array.isArray(parsed) ? parsed : [];
    } catch {}
    return tagsFilter.every(t => mediaTags.includes(t));
  });

  return filtered.slice(0, count);
}

// Returns true if the track is a video file.
function isVideoTrack(track) {
  return !!(track.mime_type && track.mime_type.startsWith('video/'));
}

// Filters a batch to be homogeneous (all-video or all-audio).
// A batch is treated as video if the majority of tracks are video.
// This prevents FFmpeg concat from failing on mixed streams.
function homogenizeBatch(tracks) {
  if (!tracks.length) return tracks;
  const videoCount = tracks.filter(isVideoTrack).length;
  const isVideoBatch = videoCount > tracks.length / 2;
  return tracks.filter(t => isVideoTrack(t) === isVideoBatch);
}

module.exports = { buildShuffleBatch, buildSequentialBatch, buildSmartPlaylistBatch, homogenizeBatch, isVideoTrack, BATCH_SIZE };
