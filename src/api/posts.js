const router = require('express').Router();
const { getDb } = require('../db');
const { requireDashboard } = require('../auth/middleware');
const { isSubscriberTier } = require('../auth/access');
const asyncHandler = require('../middleware/asyncHandler');
const { toSqliteDatetime } = require('../runtime/datetime');

const dashRouter = require('express').Router();

const VALID_VISIBILITY = new Set(['public', 'supporters_only']);

// input.published_at: optional ISO datetime string to schedule a future
// publish; omitted/undefined defaults to now (existing behavior).
function validatePostInput(input, existing = null) {
  const body = input.body !== undefined ? String(input.body || '').trim() : existing?.body;
  if (!body) return { error: 'body is required' };

  const visibility = input.visibility !== undefined ? input.visibility : (existing?.visibility ?? 'supporters_only');
  if (!VALID_VISIBILITY.has(visibility)) {
    return { error: 'visibility must be public or supporters_only' };
  }

  let publishedAt;
  if (input.published_at !== undefined) {
    if (input.published_at === null || input.published_at === '') {
      publishedAt = null;
    } else {
      publishedAt = toSqliteDatetime(input.published_at);
      if (!publishedAt) return { error: 'published_at must be a valid datetime' };
    }
  }

  return {
    value: {
      title: input.title !== undefined ? (String(input.title || '').trim() || null) : (existing?.title ?? null),
      body,
      visibility,
      publishedAt,
      notifySupporters: input.notify_supporters !== undefined ? !!input.notify_supporters : undefined,
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
    WHERE visibility IN (${placeholders}) AND published_at <= datetime('now')
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
  const { title, body, visibility, publishedAt, notifySupporters } = validated.value;

  // release_notified_at is stamped in the same INSERT when the effective
  // published_at is already due, so an immediate publish (today's default
  // behavior) fires notify once below; a future published_at leaves it NULL
  // for the release scheduler to announce later.
  const result = getDb().prepare(`
    INSERT INTO creator_posts (title, body, visibility, published_at, notify_supporters, release_notified_at)
    VALUES (
      :title, :body, :visibility,
      COALESCE(:publishedAt, datetime('now')),
      :notifySupporters,
      CASE WHEN COALESCE(:publishedAt, datetime('now')) <= datetime('now') THEN datetime('now') ELSE NULL END
    )
  `).run({ title, body, visibility, publishedAt: publishedAt ?? null, notifySupporters: notifySupporters ? 1 : 0 });

  const post = getDb().prepare('SELECT * FROM creator_posts WHERE id = ?').get(result.lastInsertRowid);
  // Webhook announce + optional supporter email — best-effort, never blocks publishing.
  if (post.release_notified_at) {
    require('../notify').postPublished(post, { emailSupporters: !!post.notify_supporters });
  }
  res.status(201).json(post);
});

dashRouter.put('/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM creator_posts WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Post not found' });

  const validated = validatePostInput(req.body || {}, existing);
  if (validated.error) return res.status(400).json({ error: validated.error });
  const { title, body, visibility, publishedAt, notifySupporters } = validated.value;

  let nextPublishedAt;
  if (publishedAt === undefined) nextPublishedAt = existing.published_at;
  else if (publishedAt === null) nextPublishedAt = toSqliteDatetime(new Date()); // explicit null = publish now
  else nextPublishedAt = publishedAt;
  const nextNotifySupporters = notifySupporters !== undefined ? (notifySupporters ? 1 : 0) : existing.notify_supporters;

  // Only stamp release_notified_at here if the post hasn't been announced yet
  // and the (possibly just-edited) published_at is now due — matches an
  // immediate publish. Once notified, further date edits never re-announce.
  const willNotifyNow = !existing.release_notified_at && nextPublishedAt <= toSqliteDatetime(new Date());

  db.prepare(`
    UPDATE creator_posts
    SET title = :title, body = :body, visibility = :visibility,
        published_at = :publishedAt, notify_supporters = :notifySupporters,
        release_notified_at = CASE WHEN :willNotifyNow THEN datetime('now') ELSE release_notified_at END,
        updated_at = datetime('now')
    WHERE id = :id
  `).run({
    title, body, visibility,
    publishedAt: nextPublishedAt,
    notifySupporters: nextNotifySupporters,
    willNotifyNow: willNotifyNow ? 1 : 0,
    id: req.params.id,
  });

  const updated = db.prepare('SELECT * FROM creator_posts WHERE id = ?').get(req.params.id);
  if (willNotifyNow) {
    require('../notify').postPublished(updated, { emailSupporters: !!updated.notify_supporters });
  }
  res.json(updated);
});

dashRouter.delete('/:id', (req, res) => {
  const changes = getDb().prepare('DELETE FROM creator_posts WHERE id = ?').run(req.params.id).changes;
  if (!changes) return res.status(404).json({ error: 'Post not found' });
  res.json({ ok: true });
});

module.exports = router;
module.exports.dashRouter = dashRouter;
