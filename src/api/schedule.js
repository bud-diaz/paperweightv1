const router = require('express').Router();
const { getDb } = require('../db');
const { requireDashboard } = require('../auth/middleware');
const { resolveCurrentBlock, isValidTime, isValidDayOfWeek } = require('../broadcast/scheduler');

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
    },
  };
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

router.post('/blocks', (req, res) => {
  const validated = validateBlockInput(req.body);
  if (validated.error) return res.status(400).json({ error: validated.error });

  const result = getDb().prepare(`
    INSERT INTO schedule_blocks (day_of_week, start_time, end_time, category, tags_filter, mode, label, priority)
    VALUES (:day_of_week, :start_time, :end_time, :category, :tags_filter, :mode, :label, :priority)
  `).run(validated.value);

  const block = getDb().prepare('SELECT * FROM schedule_blocks WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(block);
});

router.put('/blocks/:id', (req, res) => {
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
        priority    = :priority
    WHERE id = :id
  `).run({ ...validated.value, id: req.params.id });

  res.json(db.prepare('SELECT * FROM schedule_blocks WHERE id = ?').get(req.params.id));
});

router.delete('/blocks/:id', (req, res) => {
  const changes = getDb().prepare('DELETE FROM schedule_blocks WHERE id = ?').run(req.params.id).changes;
  if (!changes) return res.status(404).json({ error: 'Block not found' });
  res.json({ ok: true });
});

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
