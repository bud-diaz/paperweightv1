const router = require('express').Router();
const { getDb } = require('../db');
const { leadLimiter } = require('../middleware/rateLimiter');

const VALID_PLATFORMS = new Set(['win', 'mac-arm64', 'mac-x64', 'linux-x64', 'linux-arm64']);
// 'download_gate' (default): landing/download.html's optional email field.
// 'station_ops_waitlist': landing/station-ops.html's waitlist form. Both are
// public, unauthenticated forms — 'dashboard_signup' (the third source value)
// is deliberately not accepted here; it only comes from the authenticated
// POST /api/dashboard/signup route (src/api/dashboard.js).
const VALID_SOURCES = new Set(['download_gate', 'station_ops_waitlist']);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254;
const MAX_PLATFORM_LENGTH = 32;

function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

function normalizePlatform(platform) {
  if (typeof platform !== 'string' || platform.length > MAX_PLATFORM_LENGTH) return null;
  const key = platform.trim().toLowerCase();
  return VALID_PLATFORMS.has(key) ? key : null;
}

function normalizeSource(source) {
  if (typeof source !== 'string') return 'download_gate';
  const key = source.trim().toLowerCase();
  return VALID_SOURCES.has(key) ? key : 'download_gate';
}

router.post('/', leadLimiter, (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const platform = normalizePlatform(req.body?.platform);
  const updatesOptIn = req.body?.updatesOptIn === true ? 1 : 0;
  const source = normalizeSource(req.body?.source);

  if (!EMAIL_RE.test(email) || email.length > MAX_EMAIL_LENGTH) {
    return res.status(400).json({ error: 'Valid email is required' });
  }

  const db = getDb();
  // Dedupe: the leads list holds each address once (per-download analytics live in
  // download_events). This bounds row growth and limits list-poisoning spam.
  const existing = db.prepare('SELECT id FROM download_leads WHERE email = ? LIMIT 1').get(email);
  if (existing) {
    // Only ever escalate opt-in on a repeat submission; never silently downgrade.
    if (updatesOptIn) {
      db.prepare('UPDATE download_leads SET updates_opt_in = 1 WHERE email = ?').run(email);
    }
    return res.json({ ok: true });
  }

  db.prepare(
    'INSERT INTO download_leads (email, platform, updates_opt_in, source) VALUES (?, ?, ?, ?)'
  ).run(email, platform, updatesOptIn, source);
  res.json({ ok: true });
});

module.exports = router;
