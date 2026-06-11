// Dashboard authentication endpoints — not behind requireDashboard.
// POST /api/auth/dashboard/login    — validate token, issue session (or 2FA challenge)
// POST /api/auth/dashboard/verify-2fa — validate TOTP code against challenge, issue session
// POST /api/auth/dashboard/logout   — clear session cookie

const router = require('express').Router();
const crypto = require('crypto');
const config = require('../config');
const { getDb } = require('../db');
const { createSession, deleteSession } = require('../auth/sessions');
const { verifyTOTP, hashCode } = require('../auth/totp');
const { authLimiter } = require('../middleware/rateLimiter');

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Short-lived 2FA challenges: token → { expiresAt }
// These are server-side only — the challenge token itself proves the first factor passed.
const pendingChallenges = new Map();
const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function createChallenge() {
  // Prune stale challenges
  const now = Date.now();
  for (const [t, c] of pendingChallenges) {
    if (now > c.expiresAt) pendingChallenges.delete(t);
  }
  const token = crypto.randomBytes(24).toString('hex');
  pendingChallenges.set(token, { expiresAt: now + CHALLENGE_TTL_MS });
  return token;
}

function consumeChallenge(token) {
  const c = pendingChallenges.get(token);
  if (!c) return false;
  pendingChallenges.delete(token);
  return Date.now() <= c.expiresAt;
}

const SESSION_COOKIE = 'pw_dashboard_session';

function sessionCookieOpts(req) {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.https || req.secure,
    maxAge: 24 * 60 * 60 * 1000, // 24h
  };
}

// POST /api/auth/dashboard/login
router.post('/dashboard/login', authLimiter, (req, res) => {
  const headerToken = req.headers['x-dashboard-token'];
  const valid =
    !!config.auth.dashboardToken &&
    safeEqual(String(headerToken || ''), config.auth.dashboardToken);

  if (!valid) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  // Check whether 2FA is configured and enabled
  let twoFaEnabled = false;
  try {
    const row = getDb().prepare('SELECT enabled FROM dashboard_2fa WHERE id = 1').get();
    twoFaEnabled = !!(row && row.enabled);
  } catch {}

  if (!twoFaEnabled) {
    // Issue session immediately
    const sessionId = createSession();
    res.cookie(SESSION_COOKIE, sessionId, sessionCookieOpts(req));
    return res.json({ ok: true, requires2FA: false });
  }

  // Issue a short-lived challenge token for the 2FA step
  const challenge = createChallenge();
  res.json({ ok: true, requires2FA: true, challenge });
});

// POST /api/auth/dashboard/verify-2fa
router.post('/dashboard/verify-2fa', authLimiter, (req, res) => {
  const { challenge, code } = req.body || {};

  if (!challenge || !code) {
    return res.status(400).json({ error: 'challenge and code are required' });
  }

  if (!consumeChallenge(challenge)) {
    return res.status(401).json({ error: 'Challenge expired — start login again' });
  }

  try {
    const row = getDb()
      .prepare('SELECT secret, recovery_codes FROM dashboard_2fa WHERE id = 1 AND enabled = 1')
      .get();

    if (!row) {
      return res.status(401).json({ error: '2FA not configured' });
    }

    const codeStr = String(code).replace(/[\s-]/g, '');

    // Try TOTP first
    if (verifyTOTP(row.secret, codeStr)) {
      const sessionId = createSession();
      res.cookie(SESSION_COOKIE, sessionId, sessionCookieOpts(req));
      return res.json({ ok: true });
    }

    // Try recovery code (hashed, single-use)
    let codes = [];
    try { codes = JSON.parse(row.recovery_codes); } catch {}
    const codeHash = hashCode(codeStr.toUpperCase());
    const idx = codes.indexOf(codeHash);
    if (idx !== -1) {
      codes.splice(idx, 1);
      getDb()
        .prepare('UPDATE dashboard_2fa SET recovery_codes = ? WHERE id = 1')
        .run(JSON.stringify(codes));
      const sessionId = createSession();
      res.cookie(SESSION_COOKIE, sessionId, sessionCookieOpts(req));
      return res.json({ ok: true, usedRecoveryCode: true, codesRemaining: codes.length });
    }

    return res.status(401).json({ error: 'Invalid code' });
  } catch {
    return res.status(500).json({ error: 'Verification failed' });
  }
});

// POST /api/auth/dashboard/logout
router.post('/dashboard/logout', (req, res) => {
  const sessionId = req.cookies?.[SESSION_COOKIE];
  if (sessionId) deleteSession(sessionId);
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'strict' });
  res.json({ ok: true });
});

module.exports = router;
