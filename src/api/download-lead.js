const router = require('express').Router();
const { getDb } = require('../db');
const { authLimiter } = require('../middleware/rateLimiter');

const VALID_PLATFORMS = new Set(['win', 'mac-arm64', 'mac-x64', 'linux-x64', 'linux-arm64']);
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

router.post('/', authLimiter, (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const platform = normalizePlatform(req.body?.platform);
  const updatesOptIn = req.body?.updatesOptIn === true ? 1 : 0;

  if (!EMAIL_RE.test(email) || email.length > MAX_EMAIL_LENGTH) {
    return res.status(400).json({ error: 'Valid email is required' });
  }
  getDb().prepare(
    'INSERT INTO download_leads (email, platform, updates_opt_in) VALUES (?, ?, ?)'
  ).run(email, platform, updatesOptIn);
  res.json({ ok: true });
});

module.exports = router;
