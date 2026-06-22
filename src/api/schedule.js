const router = require('express').Router();
const { getDb } = require('../db');
const { requireDashboard } = require('../auth/middleware');
const { requireDesktop } = require('../auth/platform');
const { resolveCurrentBlock, isValidTime, isValidDayOfWeek, parseTimeToMinutes } = require('../broadcast/scheduler');
const { buildShuffleBatch, buildSequentialBatch, buildSmartPlaylistBatch } = require('../broadcast/playlist');

const PREVIEW_MAX_HOURS = 168;

router.get('/current', (req, res) => {
  const block = resolveCurrentBlock();
  res.json(block || null);
});

router.use(requireDashboard);

function normalizeDayOfWeek(value) {
  if (value === undefined || value === null || value === '') return null;
  return Number(value);
}

function validateBlockInput(input, existing = null) {
  const startTime = input.start_time ?? existing?.start_time;
  const endTime = input.end_time ?? existing?.end_time;
  const dayOfWeek = normalizeDayOfWeek(input.day_of_week ?? existing?.day_of_week ?? null);
  const mode = input.mode ?? existing?.mode ?? 'shuffle';

  if (!startTime || !endTime) {
    return { error: 'start_time and end_time are required' };
  }

  if (!isValidTime(startTime) || !isValidTime(endTime)) {
    return { error: 'start_time and end_time must use HH:MM in 24-hour time' };
  }

  if (startTime === endTime) {
    return { error: 'start_time and end_time cannot be the same' };
  }

  if (!isValidDayOfWeek(dayOfWeek)) {
    return { error: 'day_of_week must be null or an integer from 0 to 6' };
  }

  if (!['shuffle', 'sequential'].includes(mode)) {
    return { error: 'mode must be shuffle or sequential' };
  }

  const targetType = input.target_type !== undefined ? (input.target_type || null) : (existing?.target_type ?? null);
  const targetId   = input.target_id   !== undefined ? (input.target_id   != null ? Number(input.target_id) : null) : (existing?.target_id ?? null);

  return {
    value: {
      day_of_week: dayOfWeek,
      start_time: startTime,
      end_time: endTime,
      category: input.category ?? existing?.category ?? null,
      tags_filter: input.tags_filter !== undefined
        ? (input.tags_filter ? JSON.stringify(input.tags_filter) : null)
        : existing?.tags_filter ?? null,
      mode,
      label: input.label ?? existing?.label ?? null,
      priority: input.priority ?? existing?.priority ?? 0,
      target_type: targetType,
      target_id:   targetId,
    },
  };
}

function parseTagsFilter(value) {
  try {
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function trackPayload(row) {
  return {
    id: row.id,
    title: row.title || row.filename,
    artist: row.artist || null,
    duration: row.duration,
    category: row.category,
  };
}

function resolveTracksForBlock(db, block) {
  if (!block) {
    return buildShuffleBatch().map(trackPayload);
  }

  if (block.target_type === 'smart_playlist' && block.target_id) {
    const playlist = db.prepare('SELECT * FROM smart_playlists WHERE id = ?').get(block.target_id);
    if (!playlist) return [];
    return buildSmartPlaylistBatch({
      category: playlist.category || null,
      tagsFilter: parseTagsFilter(playlist.tags_filter),
      mode: playlist.mode,
    }).map(trackPayload);
  }

  if (block.mode === 'sequential') {
    return buildSequentialBatch({ blockId: block.id }).map(trackPayload);
  }

  return buildShuffleBatch({
    category: block.category || null,
    tagsFilter: parseTagsFilter(block.tags_filter),
  }).map(trackPayload);
}

function blockPayload(block) {
  if (!block) return null;
  return {
    id: block.id,
    label: block.label,
    mode: block.mode,
    category: block.category,
    target_type: block.target_type,
    target_id: block.target_id,
  };
}

function parsePreviewWindow(req) {
  const from = req.query.from ? new Date(req.query.from) : new Date();
  if (isNaN(from.getTime())) {
    return { error: 'from must be a valid ISO8601 timestamp' };
  }

  let to;
  if (req.query.to) {
    to = new Date(req.query.to);
    if (isNaN(to.getTime())) {
      return { error: 'to must be a valid ISO8601 timestamp' };
    }
  } else {
    let hours = req.query.hours !== undefined ? Number(req.query.hours) : 24;
    if (!Number.isFinite(hours) || hours <= 0) {
      return { error: 'hours must be a positive number' };
    }
    hours = Math.min(hours, PREVIEW_MAX_HOURS);
    to = new Date(from.getTime() + hours * 60 * 60000);
  }

  if (to <= from) {
    return { error: 'to must be after from' };
  }

  const hours = (to.getTime() - from.getTime()) / (60 * 60000);
  if (hours > PREVIEW_MAX_HOURS) {
    return { error: `preview window cannot exceed ${PREVIEW_MAX_HOURS} hours` };
  }

  return { from, to, hours };
}

function startOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function dateAtMinutes(day, minutes) {
  const d = new Date(day);
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return d;
}

function blockStartsOnDay(block, day) {
  return block.day_of_week == null || Number(block.day_of_week) === day.getDay();
}

function previewBoundaries(db, from, to) {
  const boundaries = new Set([from.getTime(), to.getTime()]);
  const blocks = db.prepare('SELECT * FROM schedule_blocks').all();
  const firstDay = addDays(startOfLocalDay(from), -1);
  const lastDay = addDays(startOfLocalDay(to), 1);

  for (let day = new Date(firstDay); day <= lastDay; day = addDays(day, 1)) {
    for (const block of blocks) {
      if (!blockStartsOnDay(block, day)) continue;
      const startMinutes = parseTimeToMinutes(block.start_time);
      const endMinutes = parseTimeToMinutes(block.end_time);
      if (startMinutes == null || endMinutes == null || startMinutes === endMinutes) continue;

      const blockStart = dateAtMinutes(day, startMinutes);
      const blockEnd = endMinutes > startMinutes
        ? dateAtMinutes(day, endMinutes)
        : dateAtMinutes(addDays(day, 1), endMinutes);

      if (blockEnd <= from || blockStart >= to) continue;
      boundaries.add(Math.max(blockStart.getTime(), from.getTime()));
      boundaries.add(Math.min(blockEnd.getTime(), to.getTime()));
    }
  }

  return [...boundaries].sort((a, b) => a - b);
}

function buildSchedulePreview(db, from, to) {
  const boundaries = previewBoundaries(db, from, to);
  const segments = [];
  let current = null;

  for (let i = 0; i < boundaries.length - 1; i++) {
    const startMs = boundaries[i];
    const endMs = boundaries[i + 1];
    if (endMs <= startMs) continue;

    const block = resolveCurrentBlock(new Date(startMs));
    const blockId = block ? block.id : null;
    if (current && current.blockId === blockId) {
      current.endTime = new Date(endMs).toISOString();
      current.end = current.endTime;
      continue;
    }

    if (current) segments.push(current);
    const startTime = new Date(startMs).toISOString();
    const endTime = new Date(endMs).toISOString();
    current = {
      blockId,
      label: block ? (block.label || `Block #${block.id}`) : 'Shuffle',
      startTime,
      endTime,
      tracks: resolveTracksForBlock(db, block),
      start: startTime,
      end: endTime,
      block: blockPayload(block),
    };
  }

  if (current) segments.push(current);
  return segments;
}

router.get('/', (req, res) => {
  const db = getDb();
  const blocks = db.prepare('SELECT * FROM schedule_blocks ORDER BY priority DESC, start_time ASC').all();

  const withItems = blocks.map(block => ({
    ...block,
    items: db.prepare(`
      SELECT pi.position, m.id, m.title, m.filename, m.artist, m.duration, m.category
      FROM playlist_items pi
      JOIN media m ON m.id = pi.media_id
      WHERE pi.block_id = ?
      ORDER BY pi.position
    `).all(block.id),
  }));

  res.json(withItems);
});

router.post('/blocks', requireDesktop, (req, res) => {
  const validated = validateBlockInput(req.body);
  if (validated.error) return res.status(400).json({ error: validated.error });

  const result = getDb().prepare(`
    INSERT INTO schedule_blocks (day_of_week, start_time, end_time, category, tags_filter, mode, label, priority, target_type, target_id)
    VALUES (:day_of_week, :start_time, :end_time, :category, :tags_filter, :mode, :label, :priority, :target_type, :target_id)
  `).run(validated.value);

  const block = getDb().prepare('SELECT * FROM schedule_blocks WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(block);
});

router.put('/blocks/:id', requireDesktop, (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM schedule_blocks WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Block not found' });

  const validated = validateBlockInput(req.body, existing);
  if (validated.error) return res.status(400).json({ error: validated.error });

  db.prepare(`
    UPDATE schedule_blocks
    SET day_of_week = :day_of_week,
        start_time  = :start_time,
        end_time    = :end_time,
        category    = :category,
        tags_filter = :tags_filter,
        mode        = :mode,
        label       = :label,
        priority    = :priority,
        target_type = :target_type,
        target_id   = :target_id
    WHERE id = :id
  `).run({ ...validated.value, id: req.params.id });

  res.json(db.prepare('SELECT * FROM schedule_blocks WHERE id = ?').get(req.params.id));
});

router.delete('/blocks/:id', requireDesktop, (req, res) => {
  const changes = getDb().prepare('DELETE FROM schedule_blocks WHERE id = ?').run(req.params.id).changes;
  if (!changes) return res.status(404).json({ error: 'Block not found' });
  res.json({ ok: true });
});

// Dry-run the schedule between `from` and `to` without mutating broadcast state.
router.get('/preview', requireDesktop, (req, res) => {
  const parsed = parsePreviewWindow(req);
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  const segments = buildSchedulePreview(getDb(), parsed.from, parsed.to);
  res.json({
    from: parsed.from.toISOString(),
    to: parsed.to.toISOString(),
    hours: parsed.hours,
    segments,
    timeline: segments,
  });
});

// ── Smart playlists ──────────────────────────────────────────────────────────

function validateSmartPlaylistInput(input, existing = null) {
  const name = input.name !== undefined ? String(input.name || '').trim() : existing?.name;
  if (!name) return { error: 'name is required' };

  const mode = input.mode ?? existing?.mode ?? 'shuffle';
  if (!['shuffle', 'sequential'].includes(mode)) {
    return { error: 'mode must be shuffle or sequential' };
  }

  return {
    value: {
      name,
      description: input.description !== undefined ? (input.description || null) : (existing?.description ?? null),
      category: input.category !== undefined ? (input.category || null) : (existing?.category ?? null),
      tags_filter: input.tags_filter !== undefined
        ? (input.tags_filter ? JSON.stringify(input.tags_filter) : null)
        : existing?.tags_filter ?? null,
      mode,
    },
  };
}

function matchesSmartPlaylistTracks(db, playlist) {
  const orderBy = playlist.mode === 'sequential'
    ? 'ORDER BY indexed_at ASC, id ASC'
    : 'ORDER BY RANDOM()';
  const candidates = db.prepare(`
    SELECT id, title, filename, artist, duration, category, tags, indexed_at
    FROM media
    WHERE is_active = 1
      AND visibility = 'public'
      AND (:category IS NULL OR category = :category)
    ${orderBy}
  `).all({ category: playlist.category || null });

  const tagsFilter = parseTagsFilter(playlist.tags_filter);

  if (tagsFilter.length === 0) return candidates;

  return candidates.filter(row => {
    let mediaTags = [];
    try {
      const parsed = JSON.parse(row.tags || '[]');
      mediaTags = Array.isArray(parsed) ? parsed : [];
    } catch {}
    return tagsFilter.every(t => mediaTags.includes(t));
  });
}

// Smart playlists are a desktop-only feature — gate the whole subtree.
router.use('/smart-playlists', requireDesktop);

router.get('/smart-playlists', (req, res) => {
  res.json(getDb().prepare('SELECT * FROM smart_playlists ORDER BY name ASC').all());
});

router.post('/smart-playlists', (req, res) => {
  const validated = validateSmartPlaylistInput(req.body);
  if (validated.error) return res.status(400).json({ error: validated.error });

  const result = getDb().prepare(`
    INSERT INTO smart_playlists (name, description, category, tags_filter, mode)
    VALUES (:name, :description, :category, :tags_filter, :mode)
  `).run(validated.value);

  res.status(201).json(getDb().prepare('SELECT * FROM smart_playlists WHERE id = ?').get(result.lastInsertRowid));
});

router.put('/smart-playlists/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM smart_playlists WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Smart playlist not found' });

  const validated = validateSmartPlaylistInput(req.body, existing);
  if (validated.error) return res.status(400).json({ error: validated.error });

  db.prepare(`
    UPDATE smart_playlists
    SET name = :name, description = :description, category = :category,
        tags_filter = :tags_filter, mode = :mode, updated_at = datetime('now')
    WHERE id = :id
  `).run({ ...validated.value, id: req.params.id });

  res.json(db.prepare('SELECT * FROM smart_playlists WHERE id = ?').get(req.params.id));
});

router.delete('/smart-playlists/:id', (req, res) => {
  const changes = getDb().prepare('DELETE FROM smart_playlists WHERE id = ?').run(req.params.id).changes;
  if (!changes) return res.status(404).json({ error: 'Smart playlist not found' });
  res.json({ ok: true });
});

router.get('/smart-playlists/:id/preview', (req, res) => {
  const db = getDb();
  const playlist = db.prepare('SELECT * FROM smart_playlists WHERE id = ?').get(req.params.id);
  if (!playlist) return res.status(404).json({ error: 'Smart playlist not found' });

  const tracks = matchesSmartPlaylistTracks(db, playlist).map(t => ({
    id: t.id,
    title: t.title || t.filename,
    artist: t.artist || null,
    duration: t.duration,
    category: t.category,
  }));

  res.json({ count: tracks.length, tracks });
});

router.put('/blocks/:id/items', requireDesktop, (req, res) => {
  const db = getDb();
  const block = db.prepare('SELECT * FROM schedule_blocks WHERE id = ?').get(req.params.id);
  if (!block) return res.status(404).json({ error: 'Block not found' });

  const { items } = req.body;
  if (!Array.isArray(items)) return res.status(400).json({ error: 'items must be an array' });

  const replace = db.transaction(() => {
    db.prepare('DELETE FROM playlist_items WHERE block_id = ?').run(req.params.id);
    const insert = db.prepare(
      'INSERT INTO playlist_items (block_id, media_id, position) VALUES (?, ?, ?)'
    );
    for (const item of items) {
      insert.run(req.params.id, item.media_id, item.position);
    }
  });

  replace();
  res.json({ ok: true, count: items.length });
});

module.exports = router;
