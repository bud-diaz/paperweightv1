const router = require('express').Router();
const { validateToken } = require('../auth');
const config = require('../config');

const COOKIE_NAME = 'pw_token';

function cookieOpts() {
  return {
    httpOnly: true,
    secure: config.https,
    sameSite: 'Strict',
    maxAge: 365 * 24 * 60 * 60 * 1000,
  };
}

// POST /api/tokens/redeem
// Body: { token: string }
// Sets pw_token cookie on success.
router.post('/redeem', (req, res) => {
  const { token } = req.body;
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'token is required' });
  }

  const row = validateToken(token.trim());
  if (!row) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  res.cookie(COOKIE_NAME, token.trim(), cookieOpts());
  res.json({ tier: row.tier });
});

// POST /api/tokens/logout
router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

// GET /api/tokens/me
router.get('/me', (req, res) => {
  res.json({
    authenticated: req.tier === 'subscriber',
    tier: req.tier,
  });
});

module.exports = router;
