const router = require('express').Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { getDb } = require('../db');
const { authLimiter } = require('../middleware/rateLimiter');
const { cloudOnly } = require('../middleware/cloudGate');
const asyncHandler = require('../middleware/asyncHandler');
const config = require('../config');

const BCRYPT_ROUNDS = 10;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function cookieOpts() {
  return {
    httpOnly: true,
    secure: config.https,
    sameSite: 'Strict',
    maxAge: 365 * 24 * 60 * 60 * 1000,
  };
}

// Returns the listener's active token row, or creates a new one.
function getOrCreateToken(db, listenerId, tier) {
  const existing = db.prepare(
    'SELECT * FROM tokens WHERE listener_id = ? AND is_active = 1 LIMIT 1'
  ).get(listenerId);

  if (existing) return existing;

  const token = generateToken();
  const info = db.prepare(
    "INSERT INTO tokens (token, label, tier, listener_id) VALUES (?, ?, ?, ?)"
  ).run(token, null, tier, listenerId);

  return db.prepare('SELECT * FROM tokens WHERE id = ?').get(info.lastInsertRowid);
}

// Returns the listener's active subscription, if any.
function getActiveSubscription(db, listenerId) {
  return db.prepare(
    "SELECT * FROM subscriptions WHERE listener_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1"
  ).get(listenerId) || null;
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// POST /api/listener/register
// Body: { email, password }
// Sets pw_token cookie (web) and returns { token, tier } (mobile).
router.post('/register', authLimiter, asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email is required' });
  }
  if (!password || typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const db = getDb();

  const existing = db.prepare('SELECT id FROM listener_accounts WHERE email = ?').get(email.toLowerCase().trim());
  if (existing) {
    return res.status(409).json({ error: 'An account with this email already exists' });
  }

  try {
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const info = db.prepare(
      'INSERT INTO listener_accounts (email, password_hash) VALUES (?, ?)'
    ).run(email.toLowerCase().trim(), passwordHash);

    const listenerId = info.lastInsertRowid;
    const tokenRow = getOrCreateToken(db, listenerId, 'free');

    res.cookie('pw_token', tokenRow.token, cookieOpts());
    res.status(201).json({ token: tokenRow.token, tier: tokenRow.tier });
  } catch (err) {
    res.status(500).json({ error: 'Registration failed' });
  }
}));

// POST /api/listener/login
// Body: { email, password }
// Sets pw_token cookie (web) and returns { token, tier } (mobile).
router.post('/login', authLimiter, asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const db = getDb();

  const account = db.prepare(
    'SELECT * FROM listener_accounts WHERE email = ? AND is_active = 1'
  ).get(email.toLowerCase().trim());

  if (!account) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  try {
    const match = await bcrypt.compare(password, account.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const tokenRow = getOrCreateToken(db, account.id, 'free');

    // Sync tier from active subscription if one exists
    const sub = getActiveSubscription(db, account.id);
    const tier = sub ? sub.tier : tokenRow.tier;

    res.cookie('pw_token', tokenRow.token, cookieOpts());
    res.json({ token: tokenRow.token, tier });
  } catch (err) {
    res.status(500).json({ error: 'Login failed' });
  }
}));

// POST /api/listener/logout
// Clears the pw_token cookie for web clients.
router.post('/logout', (req, res) => {
  res.clearCookie('pw_token');
  res.json({ ok: true });
});

// GET /api/listener/me
// Returns account info + current tier + subscription state + hasPassword flag.
router.get('/me', (req, res) => {
  if (!req.tokenRow || !req.tokenRow.listener_id) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const db = getDb();
  const account = db.prepare(
    'SELECT id, email, password_hash, created_at FROM listener_accounts WHERE id = ? AND is_active = 1'
  ).get(req.tokenRow.listener_id);

  if (!account) {
    return res.status(401).json({ error: 'Account not found' });
  }

  const sub = getActiveSubscription(db, account.id);

  res.json({
    email: account.email,
    tier: req.tier,
    // Accounts auto-created by Stripe have a random hex password_hash.
    // Bcrypt hashes always start with $2. This lets the UI prompt them to set a real password.
    hasPassword: account.password_hash.startsWith('$2'),
    subscriptionStatus: sub ? sub.status : null,
    currentPeriodEnd: sub ? sub.current_period_end : null,
    provider: sub ? sub.provider : null,
  });
});

// PATCH /api/listener/password
// Allows a listener to set or change their password.
// Used primarily by subscribers auto-created by Stripe (who have no usable password).
// Body: { password }  — min 8 chars
router.patch('/password', authLimiter, asyncHandler(async (req, res) => {
  if (!req.tokenRow || !req.tokenRow.listener_id) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const { password } = req.body;
  if (!password || typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  try {
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    getDb().prepare(
      "UPDATE listener_accounts SET password_hash = ? WHERE id = ?"
    ).run(passwordHash, req.tokenRow.listener_id);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update password' });
  }
}));

// ─── Saved stations ───────────────────────────────────────────────────────────
// CLOUD PHASE (gated by PAPERWEIGHT_CLOUD): the multi-station directory. A single
// Paperweight Play client saves many creator stations by core_url. Self-hosted
// builds serve one station and never call these routes.

// GET /api/listener/saved-stations
// Returns the listener's saved stations.
router.get('/saved-stations', cloudOnly, (req, res) => {
  if (!req.tokenRow || !req.tokenRow.listener_id) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const stations = getDb().prepare(
    'SELECT id, core_url, slug, name, created_at FROM listener_saved_stations WHERE listener_id = ? ORDER BY created_at ASC'
  ).all(req.tokenRow.listener_id);

  res.json({ stations });
});

// POST /api/listener/saved-stations
// Body: { coreUrl, slug, name }
router.post('/saved-stations', cloudOnly, (req, res) => {
  if (!req.tokenRow || !req.tokenRow.listener_id) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const { coreUrl, slug, name } = req.body;
  if (!coreUrl || !slug || !name) {
    return res.status(400).json({ error: 'coreUrl, slug, and name are required' });
  }

  const db = getDb();
  try {
    const info = db.prepare(
      'INSERT OR IGNORE INTO listener_saved_stations (listener_id, core_url, slug, name) VALUES (?, ?, ?, ?)'
    ).run(req.tokenRow.listener_id, coreUrl, slug, name);

    const station = db.prepare(
      'SELECT id, core_url, slug, name, created_at FROM listener_saved_stations WHERE listener_id = ? AND core_url = ? AND slug = ?'
    ).get(req.tokenRow.listener_id, coreUrl, slug);

    res.status(info.changes > 0 ? 201 : 200).json({ station });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save station' });
  }
});

// DELETE /api/listener/saved-stations/:id
router.delete('/saved-stations/:id', cloudOnly, (req, res) => {
  if (!req.tokenRow || !req.tokenRow.listener_id) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const db = getDb();
  const info = db.prepare(
    'DELETE FROM listener_saved_stations WHERE id = ? AND listener_id = ?'
  ).run(req.params.id, req.tokenRow.listener_id);

  if (info.changes === 0) {
    return res.status(404).json({ error: 'Station not found' });
  }

  res.json({ ok: true });
});

module.exports = router;
