const router = require('express').Router();
const { getDb } = require('../db');
const { requireDashboard } = require('../auth/middleware');
const { resolveCurrentBlock } = require('../broadcast/scheduler');

// Public endpoint — must be registered BEFORE requireDashboard middleware
// GET /api/schedule/current
router.get('/current', (req, res) => {
  const block = resolveCurrentBlock();
  res.json(block || null);
});

router.use(requireDashboard);

// GET /api/schedule
// Returns all blocks with their playlist_items
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

// POST /api/schedule/blocks
router.post('/blocks', (req, res) => {
  const { day_of_week, start_time, end_time, category, tags_filter, mode, label, priority } = req.body;

  if (!start_time || !end_time) {
    return res.status(400).json({ error: 'start_time and end_time are required' });
  }
  if (mode && !['shuffle', 'sequential'].includes(mode)) {
    return res.status(400).json({ error: 'mode must be shuffle or sequential' });
  }

  const result = getDb().prepare(`
    INSERT INTO schedule_blocks (day_of_week, start_time, end_time, category, tags_filter, mode, label, priority)
    VALUES (:day_of_week, :start_time, :end_time, :category, :tags_filter, :mode, :label, :priority)
  `).run({
    day_of_week: day_of_week ?? null,
    start_time,
    end_time,
    category: category || null,
    tags_filter: tags_filter ? JSON.stringify(tags_filter) : null,
    mode: mode || 'shuffle',
    label: label || null,
    priority: priority ?? 0,
  });

  const block = getDb().prepare('SELECT * FROM schedule_blocks WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(block);
});

// PUT /api/schedule/blocks/:id
router.put('/blocks/:id', (req, res) => {
  const { day_of_week, start_time, end_time, category, tags_filter, mode, label, priority } = req.body;
  const db = getDb();

  const existing = db.prepare('SELECT * FROM schedule_blocks WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Block not found' });

  db.prepare(`
    UPDATE schedule_blocks
    SET day_of_week = :day_of_week,
        start_time  = :start_time,
        end_time    = :end_time,
        category    = :category,
        tags_filter = :tags_filter,
        mode        = :mode,
        label       = :label,
        priority    = :priority
    WHERE id = :id
  `).run({
    id: req.params.id,
    day_of_week: day_of_week ?? existing.day_of_week,
    start_time:  start_time  ?? existing.start_time,
    end_time:    end_time    ?? existing.end_time,
    category:    category    ?? existing.category,
    tags_filter: tags_filter ? JSON.stringify(tags_filter) : existing.tags_filter,
    mode:        mode        ?? existing.mode,
    label:       label       ?? existing.label,
    priority:    priority    ?? existing.priority,
  });

  res.json(db.prepare('SELECT * FROM schedule_blocks WHERE id = ?').get(req.params.id));
});

// DELETE /api/schedule/blocks/:id
router.delete('/blocks/:id', (req, res) => {
  const changes = getDb().prepare('DELETE FROM schedule_blocks WHERE id = ?').run(req.params.id).changes;
  if (!changes) return res.status(404).json({ error: 'Block not found' });
  res.json({ ok: true });
});

// PUT /api/schedule/blocks/:id/items
// Full replace of playlist_items for a block.
// Body: { items: [{ media_id, position }] }
router.put('/blocks/:id/items', (req, res) => {
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
