// Dashboard authentication endpoints — not behind requireDashboard.
// POST /api/auth/dashboard/login    — validate token, issue session (or 2FA challenge)
// POST /api/auth/dashboard/verify-2fa — validate TOTP code against challenge, issue session
// POST /api/auth/dashboard/logout   — clear session cookie

const router = require('express').Router();
const crypto = require('crypto');
const config = require('../config');
const { getDb } = require('../db');
const { createSession, deleteSession } = require('../auth/sessions');
const { matchTOTPCounter, hashCode } = require('../auth/totp');
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
const MAX_PENDING_CHALLENGES = 100;

function createChallenge() {
  // Prune stale challenges
  const now = Date.now();
  for (const [t, c] of pendingChallenges) {
    if (now > c.expiresAt) pendingChallenges.delete(t);
  }
  // Hard cap so a burst of logins can't grow the map without bound. Map
  // preserves insertion order, so this drops the oldest entries first.
  while (pendingChallenges.size >= MAX_PENDING_CHALLENGES) {
    pendingChallenges.delete(pendingChallenges.keys().next().value);
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
      .prepare('SELECT secret, recovery_codes, last_totp_counter FROM dashboard_2fa WHERE id = 1 AND enabled = 1')
      .get();

    if (!row) {
      return res.status(401).json({ error: '2FA not configured' });
    }

    const codeStr = String(code).replace(/[\s-]/g, '');

    // Try TOTP first — reject any counter at or below the last one accepted so a
    // valid code cannot be replayed within its window.
    const matchedCounter = matchTOTPCounter(row.secret, codeStr, {
      after: Number.isInteger(row.last_totp_counter) ? row.last_totp_counter : -1,
    });
    if (matchedCounter !== null) {
      getDb()
        .prepare('UPDATE dashboard_2fa SET last_totp_counter = ? WHERE id = 1')
        .run(matchedCounter);
      const sessionId = createSession();
      res.cookie(SESSION_COOKIE, sessionId, sessionCookieOpts(req));
      return res.json({ ok: true });
    }

    // Try recovery code (hashed, single-use). Accept both the canonical dash-free
    // hash and the legacy dashed-format hash for backward compatibility.
    let codes = [];
    try { codes = JSON.parse(row.recovery_codes); } catch {}
    const upper = codeStr.toUpperCase();
    const dashed = upper.length === 12 ? `${upper.slice(0, 4)}-${upper.slice(4, 8)}-${upper.slice(8, 12)}` : upper;
    // Compare stored hashes in constant time. safeEqual re-hashes both sides,
    // so lengths always match and timingSafeEqual never sees an early-return.
    const upperHash = hashCode(upper);
    const dashedHash = hashCode(dashed);
    const idx = codes.findIndex(h => safeEqual(h, upperHash) || safeEqual(h, dashedHash));
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
  const { secure, httpOnly, sameSite } = sessionCookieOpts(req);
  res.clearCookie(SESSION_COOKIE, { httpOnly, sameSite, secure });
  res.json({ ok: true });
});

module.exports = router;
