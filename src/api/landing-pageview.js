const router = require('express').Router();
const { getDb } = require('../db');
const { generalLimiter } = require('../middleware/rateLimiter');

const MAX_FIELD_LENGTH = 256;

function clean(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, MAX_FIELD_LENGTH);
  return trimmed || null;
}

// POST /api/landing/pageview — fire-and-forget visit beacon from landing/*.html.
// No cookies, no third-party script, no PII: just path + attribution params.
router.post('/', generalLimiter, (req, res) => {
  const path = clean(req.body?.path) || '/';
  const source = clean(req.body?.source);
  const medium = clean(req.body?.medium);
  const campaign = clean(req.body?.campaign);
  const referrer = clean(req.body?.referrer);

  getDb().prepare(
    'INSERT INTO landing_pageviews (path, source, medium, campaign, referrer) VALUES (?, ?, ?, ?, ?)'
  ).run(path, source, medium, campaign, referrer);

  res.json({ ok: true });
});

module.exports = router;
