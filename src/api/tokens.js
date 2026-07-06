const router = require('express').Router();
const { validateToken } = require('../auth');
const { isSubscriberTier } = require('../auth/access');
const { tokenRedeemLimiter } = require('../middleware/rateLimiter');
const { LISTENER_COOKIE_NAME, listenerCookieOpts, clearListenerCookie } = require('../auth/cookies');

// POST /api/tokens/redeem
// Body: { token: string }
// Sets pw_token cookie on success.
router.post('/redeem', tokenRedeemLimiter, (req, res) => {
  const { token } = req.body;
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'token is required' });
  }

  const row = validateToken(token.trim());
  if (!row) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  res.cookie(LISTENER_COOKIE_NAME, token.trim(), listenerCookieOpts(req));
  res.json({ tier: row.tier });
});

// POST /api/tokens/logout
router.post('/logout', (req, res) => {
  clearListenerCookie(res, req);
  res.json({ ok: true });
});

// GET /api/tokens/me
router.get('/me', (req, res) => {
  res.json({
    authenticated: isSubscriberTier(req.tier),
    tier: req.tier,
  });
});

module.exports = router;
