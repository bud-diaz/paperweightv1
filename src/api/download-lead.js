const router = require('express').Router();
const { getDb } = require('../db');
const { authLimiter } = require('../middleware/rateLimiter');

router.post('/', authLimiter, (req, res) => {
  const { email, platform } = req.body;
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email is required' });
  }
  getDb().prepare(
    'INSERT INTO download_leads (email, platform) VALUES (?, ?)'
  ).run(email.toLowerCase().trim(), platform || null);
  res.json({ ok: true });
});

module.exports = router;
