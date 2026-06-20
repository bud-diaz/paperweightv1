const router = require('express').Router();
const { getDb } = require('../db');
const { requireDashboard } = require('../auth/middleware');
const { isSubscriberTier } = require('../auth/access');
const asyncHandler = require('../middleware/asyncHandler');

const dashRouter = require('express').Router();

const VALID_VISIBILITY = new Set(['public', 'supporters_only']);

function validatePostInput(input, existing = null) {
  const body = input.body !== undefined ? String(input.body || '').trim() : existing?.body;
  if (!body) return { error: 'body is required' };

  const visibility = input.visibility !== undefined ? input.visibility : (existing?.visibility ?? 'supporters_only');
  if (!VALID_VISIBILITY.has(visibility)) {
    return { error: 'visibility must be public or supporters_only' };
  }

  return {
    value: {
      title: input.title !== undefined ? (String(input.title || '').trim() || null) : (existing?.title ?? null),
      body,
      visibility,
    },
  };
}

// ── Listener-facing: GET /api/posts ─────────────────────────────────────────
router.get('/', asyncHandler(async (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const offset = (page - 1) * limit;

  const db = getDb();
  const visibilities = isSubscriberTier(req.tier) ? ['public', 'supporters_only'] : ['public'];
  const placeholders = visibilities.map(() => '?').join(',');

  const posts = db.prepare(`
    SELECT id, title, body, visibility, published_at
    FROM creator_posts
    WHERE visibility IN (${placeholders})
    ORDER BY published_at DESC
    LIMIT ? OFFSET ?
  `).all(...visibilities, limit, offset);

  res.json({ posts, page, limit });
}));

// ── Dashboard management routes ─────────────────────────────────────────────
dashRouter.use(requireDashboard);

dashRouter.get('/', (req, res) => {
  res.json(getDb().prepare('SELECT * FROM creator_posts ORDER BY published_at DESC').all());
});

dashRouter.post('/', (req, res) => {
  const validated = validatePostInput(req.body || {});
  if (validated.error) return res.status(400).json({ error: validated.error });

  const result = getDb().prepare(`
    INSERT INTO creator_posts (title, body, visibility)
    VALUES (:title, :body, :visibility)
  `).run(validated.value);

  res.status(201).json(getDb().prepare('SELECT * FROM creator_posts WHERE id = ?').get(result.lastInsertRowid));
});

dashRouter.put('/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM creator_posts WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Post not found' });

  const validated = validatePostInput(req.body || {}, existing);
  if (validated.error) return res.status(400).json({ error: validated.error });

  db.prepare(`
    UPDATE creator_posts
    SET title = :title, body = :body, visibility = :visibility, updated_at = datetime('now')
    WHERE id = :id
  `).run({ ...validated.value, id: req.params.id });

  res.json(db.prepare('SELECT * FROM creator_posts WHERE id = ?').get(req.params.id));
});

dashRouter.delete('/:id', (req, res) => {
  const changes = getDb().prepare('DELETE FROM creator_posts WHERE id = ?').run(req.params.id).changes;
  if (!changes) return res.status(404).json({ error: 'Post not found' });
  res.json({ ok: true });
});

module.exports = router;
module.exports.dashRouter = dashRouter;
