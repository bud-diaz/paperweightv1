const router = require('express').Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { getDb, log } = require('../db');
const { hashToken } = require('../auth');
const { authLimiter } = require('../middleware/rateLimiter');
const { cloudOnly } = require('../middleware/cloudGate');
const asyncHandler = require('../middleware/asyncHandler');
const config = require('../config');
const { isEmailConfigured, sendMail } = require('../email');
const { publicBaseUrl } = require('../runtime/base-url');
const { listenerCookieOpts, clearListenerCookie } = require('../auth/cookies');
const { isHigherTier } = require('../auth/access');

const BCRYPT_ROUNDS = 10;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Lowercased, trimmed address or null when implausible.
function normalizeEmail(email) {
  if (typeof email !== 'string') return null;
  const value = email.trim().toLowerCase();
  return EMAIL_RE.test(value) && value.length <= MAX_EMAIL_LENGTH ? value : null;
}

// Trimmed, control-char-stripped display name or null when invalid.
function cleanDisplayName(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim().replace(/[\x00-\x1F\x7F]/g, '');
  return name && name.length <= 50 ? name : null;
}

// Mints a fresh per-login token for the listener and stores only its hash.
// Returns { token (raw, shown once), tier }. Each call issues a new token so the
// raw value never has to be recovered from the database — supports multiple
// concurrent devices, each with its own credential.
function issueToken(db, listenerId, tier) {
  const token = generateToken();
  const tokenHash = hashToken(token);
  const info = db.prepare(
    "INSERT INTO tokens (token, token_hash, label, tier, listener_id) VALUES (?, ?, ?, ?, ?)"
  ).run(tokenHash, tokenHash, null, tier, listenerId);
  return { token, tier, tokenId: info.lastInsertRowid };
}

// Lightweight identity from the welcome page (migration 026). Resolved by the
// full account when one exists, else by the token issued at /start.
function getProfileForRequest(db, tokenRow) {
  if (!tokenRow) return null;
  if (tokenRow.listener_id) {
    const byAccount = db.prepare(
      'SELECT * FROM listener_profiles WHERE account_id = ? ORDER BY created_at DESC LIMIT 1'
    ).get(tokenRow.listener_id);
    if (byAccount) return byAccount;
  }
  return db.prepare('SELECT * FROM listener_profiles WHERE token_id = ?').get(tokenRow.id) || null;
}

// Links an unclaimed welcome-page profile to a full account (on register/login
// with the profile's pw_token still present) so display name, marketing consent,
// and the original entry token carry over.
function linkProfileToAccount(db, tokenRow, accountId) {
  if (!tokenRow || tokenRow.listener_id) return;
  const profile = db.prepare(
    'SELECT id FROM listener_profiles WHERE token_id = ? AND account_id IS NULL'
  ).get(tokenRow.id);
  if (!profile) return;
  db.prepare('UPDATE listener_profiles SET account_id = ? WHERE id = ?').run(accountId, profile.id);
  db.prepare('UPDATE tokens SET listener_id = ? WHERE id = ?').run(accountId, tokenRow.id);
}

// Returns the listener's active subscription, if any.
function getActiveSubscription(db, listenerId) {
  const rows = db.prepare(
    "SELECT * FROM subscriptions WHERE listener_id = ? AND status = 'active' ORDER BY created_at DESC"
  ).all(listenerId);
  let best = null;
  const nowMs = Date.now();
  for (const row of rows) {
    const expiresAt = new Date(row.current_period_end).getTime();
    if (!Number.isFinite(expiresAt) || expiresAt <= nowMs) continue;
    if (!best || isHigherTier(row.tier, best.tier)) {
      best = row;
    }
  }
  return best;
}

const RESET_TTL_MINUTES = 60;
const VERIFY_TTL_MINUTES = 24 * 60;
const AUTO_LOGIN_TTL_MINUTES = 30;

// Creates a password reset row and returns the raw token (stored only as a
// SHA-256 hash). `via` is 'email' (listener-requested) or 'dashboard' (creator
// generated a link manually — the no-SMTP fallback).
function createPasswordReset(db, listenerId, via) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + RESET_TTL_MINUTES * 60 * 1000).toISOString();
  db.prepare(
    'INSERT INTO password_resets (listener_id, token_hash, created_via, expires_at) VALUES (?, ?, ?, ?)'
  ).run(listenerId, hashToken(token), via, expiresAt);
  return { token, expiresAt };
}

function resetLinkUrl(req, token) {
  return `${publicBaseUrl(req)}/#reset=${token}`;
}

// Creates a single-use listener_email_tokens row and returns the raw token
// (stored only as a SHA-256 hash). `purpose` is 'verify' (confirms the
// listener owns the email on file) or 'login' (tip-flow auto-login link).
function createEmailToken(db, listenerId, purpose, ttlMinutes) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();
  db.prepare(
    'INSERT INTO listener_email_tokens (listener_id, token_hash, purpose, expires_at) VALUES (?, ?, ?, ?)'
  ).run(listenerId, hashToken(token), purpose, expiresAt);
  return { token, expiresAt };
}

function verifyLinkUrl(req, token) {
  return `${publicBaseUrl(req)}/#verify=${token}`;
}

function autoLoginLinkUrl(req, token) {
  return `${publicBaseUrl(req)}/#autologin=${token}`;
}

// Consumes a listener_email_tokens row of the given purpose. Returns the
// listener_id on success, or null if the token is missing/used/expired/wrong
// purpose. Marks the token used as a side effect of a successful consume.
function consumeEmailToken(db, token, purpose) {
  if (!token || typeof token !== 'string') return null;
  const row = db.prepare(
    'SELECT * FROM listener_email_tokens WHERE token_hash = ? AND purpose = ?'
  ).get(hashToken(token), purpose);
  const expired = row && new Date(row.expires_at).getTime() < Date.now();
  if (!row || row.used_at || expired) return null;

  db.prepare("UPDATE listener_email_tokens SET used_at = datetime('now') WHERE id = ?").run(row.id);
  return row.listener_id;
}

// Marks the account's email verified if it isn't already. Both the verify
// link and the tip auto-login link (mailed to the listener's own inbox)
// count as proof of ownership.
function markEmailVerified(db, listenerId) {
  db.prepare(
    "UPDATE listener_accounts SET email_verified_at = datetime('now') WHERE id = ? AND email_verified_at IS NULL"
  ).run(listenerId);
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// POST /api/listener/start
// Retired: the welcome page used to create an account-less profile + token
// here. Sign-up now requires an email and goes through /register; a stale
// cached client that still POSTs here gets a loud failure instead of a fresh
// email-less token.
router.post('/start', authLimiter, (req, res) => {
  res.status(410).json({ error: 'Signing up now requires an email — please reload the page' });
});

// POST /api/listener/register
// Body: { email, password, displayName?, marketingOptIn? }
// Sets pw_token cookie (web) and returns { token, tier } (mobile). The welcome
// page sends displayName/marketingOptIn so entry creates a full account plus
// the listener profile that feeds the creator's audience list.
router.post('/register', authLimiter, asyncHandler(async (req, res) => {
  const { email, password, displayName, marketingOptIn } = req.body;

  const cleanEmail = normalizeEmail(email);
  if (!cleanEmail) {
    return res.status(400).json({ error: 'Valid email is required' });
  }
  if (!password || typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  let name = null;
  if (displayName !== undefined && displayName !== null && displayName !== '') {
    name = cleanDisplayName(displayName);
    if (!name) {
      return res.status(400).json({ error: 'Display name must be 50 characters or fewer' });
    }
  }

  const db = getDb();

  const existing = db.prepare('SELECT id FROM listener_accounts WHERE email = ?').get(cleanEmail);
  if (existing) {
    return res.status(409).json({ error: 'An account with this email already exists' });
  }

  try {
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const listenerId = db.transaction(() => {
      const info = db.prepare(
        'INSERT INTO listener_accounts (email, password_hash) VALUES (?, ?)'
      ).run(cleanEmail, passwordHash);

      const accountId = info.lastInsertRowid;
      // Carry over a welcome-page profile (display name, marketing consent)
      // when the listener upgrades to a full account on the same device.
      linkProfileToAccount(db, req.tokenRow, accountId);

      // Keep the profile (the creator's audience list) in step with the
      // account: copy the account email in, and apply the sign-up's display
      // name / consent when given.
      const profile = db.prepare(
        'SELECT id FROM listener_profiles WHERE account_id = ? ORDER BY created_at DESC LIMIT 1'
      ).get(accountId);
      if (profile) {
        db.prepare(`
          UPDATE listener_profiles SET
            display_name     = COALESCE(?, display_name),
            email            = ?,
            marketing_opt_in = CASE WHEN ? IS NOT NULL THEN ? ELSE marketing_opt_in END,
            last_seen_at     = datetime('now')
          WHERE id = ?
        `).run(
          name,
          cleanEmail,
          marketingOptIn === undefined ? null : 1,
          marketingOptIn === true ? 1 : 0,
          profile.id
        );
      } else if (name) {
        db.prepare(`
          INSERT INTO listener_profiles (display_name, email, marketing_opt_in, account_id, last_seen_at)
          VALUES (?, ?, ?, ?, datetime('now'))
        `).run(name, cleanEmail, marketingOptIn === true ? 1 : 0, accountId);
      }
      return accountId;
    })();

    const issued = issueToken(db, listenerId, 'free');

    res.cookie('pw_token', issued.token, listenerCookieOpts(req));
    res.status(201).json({ token: issued.token, tier: issued.tier });
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

    const sub = getActiveSubscription(db, account.id);
    const tier = sub ? sub.tier : 'free';
    linkProfileToAccount(db, req.tokenRow, account.id);
    const issued = issueToken(db, account.id, tier);

    res.cookie('pw_token', issued.token, listenerCookieOpts(req));
    res.json({ token: issued.token, tier });
  } catch (err) {
    res.status(500).json({ error: 'Login failed' });
  }
}));

// POST /api/listener/logout
// Clears the pw_token cookie for web clients.
router.post('/logout', (req, res) => {
  clearListenerCookie(res, req);
  res.json({ ok: true });
});

// GET /api/listener/me
// Returns account info + current tier + subscription state + hasPassword flag.
// Also answers for welcome-page profiles that have no full account yet, and
// refreshes last_seen_at so repeat listeners are visible to the creator.
router.get('/me', (req, res) => {
  if (!req.tokenRow) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const db = getDb();
  const profile = getProfileForRequest(db, req.tokenRow);
  if (profile) {
    db.prepare("UPDATE listener_profiles SET last_seen_at = datetime('now') WHERE id = ?").run(profile.id);
  }

  if (!req.tokenRow.listener_id) {
    if (!profile) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    return res.json({
      email: profile.email,
      displayName: profile.display_name,
      tier: req.tier,
      hasAccount: false,
      hasPassword: false,
      marketingOptIn: profile.marketing_opt_in === 1,
      subscriptionStatus: null,
      currentPeriodEnd: null,
      provider: null,
    });
  }

  const account = db.prepare(
    `SELECT id, email, password_hash, created_at, email_verified_at,
            email_verification_required_at, settings_tour_seen_at
     FROM listener_accounts WHERE id = ? AND is_active = 1`
  ).get(req.tokenRow.listener_id);

  if (!account) {
    return res.status(401).json({ error: 'Account not found' });
  }

  const sub = getActiveSubscription(db, account.id);

  res.json({
    email: account.email,
    displayName: profile ? profile.display_name : null,
    tier: req.tier,
    hasAccount: true,
    // Accounts auto-created by Stripe have a random hex password_hash.
    // Bcrypt hashes always start with $2. This lets the UI prompt them to set a real password.
    hasPassword: account.password_hash.startsWith('$2'),
    marketingOptIn: profile ? profile.marketing_opt_in === 1 : false,
    subscriptionStatus: sub ? sub.status : null,
    currentPeriodEnd: sub ? sub.current_period_end : null,
    provider: sub ? sub.provider : null,
    emailVerified: !!account.email_verified_at,
    emailVerificationRequiredAt: account.email_verification_required_at,
    settingsTourSeenAt: account.settings_tour_seen_at,
  });
});

// POST /api/listener/verify-email
// Body: { token } — completes an email verification link (from the initial
// paid-tier verification email or a resend). No auth required: the token
// itself proves ownership of the mailbox it was sent to.
router.post('/verify-email', authLimiter, (req, res) => {
  const { token } = req.body || {};
  const db = getDb();
  const listenerId = consumeEmailToken(db, token, 'verify');
  if (!listenerId) {
    return res.status(400).json({ error: 'Verification link is invalid or has expired' });
  }
  markEmailVerified(db, listenerId);
  log('info', 'listener', `Email verified for listener #${listenerId}`);
  res.json({ ok: true });
});

// POST /api/listener/resend-verification
// Requires login. No-ops quietly if already verified or SMTP is unconfigured
// (mirrors request-password-reset's no-enumeration style).
router.post('/resend-verification', authLimiter, (req, res) => {
  if (!req.tokenRow || !req.tokenRow.listener_id) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const emailEnabled = isEmailConfigured();
  const db = getDb();
  const account = db.prepare(
    'SELECT id, email, email_verified_at FROM listener_accounts WHERE id = ? AND is_active = 1'
  ).get(req.tokenRow.listener_id);

  if (account && !account.email_verified_at && emailEnabled) {
    const { token } = createEmailToken(db, account.id, 'verify', VERIFY_TTL_MINUTES);
    const url = verifyLinkUrl(req, token);
    const station = config.station.name || 'Paperweight';
    setImmediate(() => {
      sendMail({
        to: account.email,
        subject: `Verify your email for ${station}`,
        text: [
          `Please confirm this is your email address for your ${station} account.`,
          '',
          `Open this link to verify (valid for ${Math.round(VERIFY_TTL_MINUTES / 60)} hours):`,
          url,
        ].join('\n'),
      }).catch(err => {
        log('error', 'listener', `Verification email to listener #${account.id} failed: ${err.message}`);
      });
    });
  }

  res.json({ ok: true, emailEnabled });
});

// POST /api/listener/auto-login
// Body: { token } — consumes a tip-flow login link, verifies the email (a
// link mailed to the listener's own inbox proves ownership), and logs them
// in by issuing a fresh pw_token.
router.post('/auto-login', (req, res) => {
  const { token } = req.body || {};
  const db = getDb();
  const listenerId = consumeEmailToken(db, token, 'login');
  if (!listenerId) {
    return res.status(400).json({ error: 'Login link is invalid or has expired' });
  }

  const account = db.prepare('SELECT id FROM listener_accounts WHERE id = ? AND is_active = 1').get(listenerId);
  if (!account) {
    return res.status(400).json({ error: 'Account not found' });
  }

  markEmailVerified(db, account.id);
  const sub = getActiveSubscription(db, account.id);
  const issued = issueToken(db, account.id, sub ? sub.tier : 'free');

  res.cookie('pw_token', issued.token, listenerCookieOpts(req));
  res.json({ token: issued.token, tier: issued.tier });
});

// POST /api/listener/settings-tour-seen
// Marks the one-time Settings spotlight dismissed so it never shows again.
router.post('/settings-tour-seen', (req, res) => {
  if (!req.tokenRow || !req.tokenRow.listener_id) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  getDb().prepare(
    "UPDATE listener_accounts SET settings_tour_seen_at = datetime('now') WHERE id = ? AND settings_tour_seen_at IS NULL"
  ).run(req.tokenRow.listener_id);
  res.json({ ok: true });
});

// POST /api/listener/request-password-reset
// Body: { email }
// Always answers { ok: true } so account existence is never revealed. When the
// account exists and SMTP is configured, a reset link is emailed in the
// background (fire-and-forget, so response timing stays constant too).
router.post('/request-password-reset', authLimiter, (req, res) => {
  const emailEnabled = isEmailConfigured();
  const { email } = req.body || {};

  if (email && typeof email === 'string' && email.includes('@') && emailEnabled) {
    const db = getDb();
    const account = db.prepare(
      'SELECT id, email FROM listener_accounts WHERE email = ? AND is_active = 1'
    ).get(email.toLowerCase().trim());

    if (account) {
      const { token } = createPasswordReset(db, account.id, 'email');
      const url = resetLinkUrl(req, token);
      const station = config.station.name || 'Paperweight';
      setImmediate(() => {
        sendMail({
          to: account.email,
          subject: `Reset your ${station} password`,
          text: [
            `A password reset was requested for your ${station} account.`,
            '',
            `Open this link to choose a new password (valid for ${RESET_TTL_MINUTES} minutes):`,
            url,
            '',
            "If you didn't request this, you can ignore this email — your password is unchanged.",
          ].join('\n'),
        }).catch(err => {
          log('error', 'listener', `Password reset email to listener #${account.id} failed: ${err.message}`);
        });
      });
    }
  }

  res.json({ ok: true, emailEnabled });
});

// POST /api/listener/reset-password
// Body: { token, password } — completes a reset started by
// request-password-reset or a dashboard-generated link.
router.post('/reset-password', authLimiter, asyncHandler(async (req, res) => {
  const { token, password } = req.body || {};

  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'Reset token is required' });
  }
  if (!password || typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const db = getDb();
  const reset = db.prepare('SELECT * FROM password_resets WHERE token_hash = ?').get(hashToken(token));
  const expired = reset && new Date(reset.expires_at).getTime() < Date.now();
  if (!reset || reset.used_at || expired) {
    return res.status(400).json({ error: 'Reset link is invalid or has expired' });
  }

  const account = db.prepare(
    'SELECT id FROM listener_accounts WHERE id = ? AND is_active = 1'
  ).get(reset.listener_id);
  if (!account) {
    return res.status(400).json({ error: 'Reset link is invalid or has expired' });
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  db.transaction(() => {
    db.prepare('UPDATE listener_accounts SET password_hash = ? WHERE id = ?').run(passwordHash, account.id);
    // Consume every outstanding reset for this listener, not just the one used.
    db.prepare(
      "UPDATE password_resets SET used_at = datetime('now') WHERE listener_id = ? AND used_at IS NULL"
    ).run(account.id);
  })();

  log('info', 'listener', `Password reset completed for listener #${account.id}`);
  res.json({ ok: true });
}));

// GET /api/listener/export
// Returns everything stored about the authenticated listener as downloadable JSON.
// Welcome-page profiles without a full account export their profile row alone.
router.get('/export', (req, res) => {
  if (!req.tokenRow) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const db = getDb();
  const profile = getProfileForRequest(db, req.tokenRow);
  const profileExport = profile ? {
    displayName: profile.display_name,
    email: profile.email,
    marketingOptIn: profile.marketing_opt_in === 1,
    createdAt: profile.created_at,
    lastSeenAt: profile.last_seen_at,
  } : null;

  if (!req.tokenRow.listener_id) {
    if (!profile) return res.status(401).json({ error: 'Authentication required' });
    res.setHeader('Content-Disposition', 'attachment; filename="paperweight-account-export.json"');
    return res.json({
      exportedAt: new Date().toISOString(),
      station: config.station.name,
      profile: profileExport,
      tier: req.tier,
    });
  }

  const account = db.prepare(
    'SELECT id, email, created_at FROM listener_accounts WHERE id = ? AND is_active = 1'
  ).get(req.tokenRow.listener_id);
  if (!account) return res.status(401).json({ error: 'Account not found' });

  const subscriptions = db.prepare(
    'SELECT tier, provider, provider_subscription_id, status, current_period_end, created_at FROM subscriptions WHERE listener_id = ? ORDER BY created_at'
  ).all(account.id);
  const vaultUnlocks = db.prepare(
    'SELECT unlock_type, target_id, amount_paid, payment_type, active, expires_at, created_at FROM vault_unlocks WHERE listener_id = ? ORDER BY created_at'
  ).all(account.id);
  const tokenAssignments = db.prepare(
    `SELECT t.label, t.tier, ta.created_at FROM token_assignments ta
     JOIN tokens t ON t.id = ta.token_id WHERE ta.listener_id = ? ORDER BY ta.created_at`
  ).all(account.id);
  const savedStations = db.prepare(
    'SELECT core_url, slug, name, created_at FROM listener_saved_stations WHERE listener_id = ? ORDER BY created_at'
  ).all(account.id);

  res.setHeader('Content-Disposition', 'attachment; filename="paperweight-account-export.json"');
  res.json({
    exportedAt: new Date().toISOString(),
    station: config.station.name,
    account: { email: account.email, createdAt: account.created_at },
    profile: profileExport,
    tier: req.tier,
    subscriptions,
    vaultUnlocks,
    tokenAssignments,
    savedStations,
  });
});

// DELETE /api/listener/profile
// Self-service deletion for welcome-page profiles that never became a full
// account: removes the profile row and its entry token. Full accounts use
// DELETE /api/listener/account instead.
router.delete('/profile', authLimiter, (req, res) => {
  if (!req.tokenRow) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  if (req.tokenRow.listener_id) {
    return res.status(400).json({ error: 'Use account deletion for full accounts' });
  }

  const db = getDb();
  const profile = db.prepare('SELECT * FROM listener_profiles WHERE token_id = ?').get(req.tokenRow.id);
  if (!profile) return res.status(404).json({ error: 'Profile not found' });

  db.transaction(() => {
    db.prepare('DELETE FROM listener_profiles WHERE id = ?').run(profile.id);
    db.prepare('DELETE FROM tokens WHERE id = ?').run(req.tokenRow.id);
  })();

  clearListenerCookie(res, req);
  log('info', 'listener', `Listener profile #${profile.id} deleted at owner request`);
  res.json({ ok: true });
});

// DELETE /api/listener/account
// Body: { password } — or { confirmEmail } for accounts auto-created by Stripe
// that never set a password. Cancels active subscriptions at the provider
// (best effort), revokes tokens, and scrubs the account's PII. Purchase records
// (subscriptions, vault unlocks) are kept for accounting, detached from any
// usable identity.
router.delete('/account', authLimiter, asyncHandler(async (req, res) => {
  if (!req.tokenRow || !req.tokenRow.listener_id) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const db = getDb();
  const account = db.prepare(
    'SELECT * FROM listener_accounts WHERE id = ? AND is_active = 1'
  ).get(req.tokenRow.listener_id);
  if (!account) return res.status(401).json({ error: 'Account not found' });

  const { password, confirmEmail } = req.body || {};
  const hasRealPassword = account.password_hash.startsWith('$2');
  if (hasRealPassword) {
    if (!password) return res.status(400).json({ error: 'Current password is required' });
    const match = await bcrypt.compare(password, account.password_hash);
    if (!match) return res.status(401).json({ error: 'Incorrect password' });
  } else if (!confirmEmail || String(confirmEmail).toLowerCase().trim() !== account.email) {
    return res.status(400).json({ error: 'confirmEmail must match the account email' });
  }

  // Best-effort provider-side cancellation so deleted accounts stop being billed.
  const { providerCancelSubscription } = require('./payment');
  const activeSubs = db.prepare(
    "SELECT * FROM subscriptions WHERE listener_id = ? AND status = 'active'"
  ).all(account.id);
  const cancelWarnings = [];
  for (const sub of activeSubs) {
    try {
      await providerCancelSubscription(sub, { immediate: true });
    } catch (err) {
      log('warn', 'listener', `Account deletion: could not cancel ${sub.provider} subscription ${sub.provider_subscription_id}: ${err.message}`);
      cancelWarnings.push(`Could not cancel ${sub.provider} subscription — cancel it from your ${sub.provider} account.`);
    }
  }

  db.transaction(() => {
    // Profiles hold PII (display name, marketing email) — remove them outright.
    db.prepare('DELETE FROM listener_profiles WHERE account_id = ?').run(account.id);
    db.prepare('DELETE FROM tokens WHERE listener_id = ?').run(account.id);
    db.prepare('DELETE FROM token_assignments WHERE listener_id = ?').run(account.id);
    db.prepare('DELETE FROM listener_saved_stations WHERE listener_id = ?').run(account.id);
    db.prepare('DELETE FROM download_tokens WHERE listener_id = ?').run(account.id);
    db.prepare('DELETE FROM password_resets WHERE listener_id = ?').run(account.id);
    db.prepare('UPDATE vault_unlocks SET active = 0 WHERE listener_id = ?').run(account.id);
    db.prepare("UPDATE subscriptions SET status = 'expired' WHERE listener_id = ? AND status = 'active'").run(account.id);
    db.prepare('UPDATE listener_accounts SET email = ?, password_hash = ?, is_active = 0 WHERE id = ?')
      .run(`deleted-${account.id}@account.invalid`, crypto.randomBytes(32).toString('hex'), account.id);
  })();

  clearListenerCookie(res, req);
  log('info', 'listener', `Listener account #${account.id} deleted at owner request`);
  res.json({ ok: true, warnings: cancelWarnings.length ? cancelWarnings : undefined });
}));

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

// PATCH /api/listener/preferences
// Body: { marketingOptIn: boolean } — the only preference so far. Updates the
// listener_profiles row for this account (created lazily if the listener
// never went through the welcome-page flow, e.g. tip-created or registered
// directly), since marketing_opt_in lives there rather than on the account.
router.patch('/preferences', authLimiter, (req, res) => {
  if (!req.tokenRow || !req.tokenRow.listener_id) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const { marketingOptIn } = req.body || {};
  if (typeof marketingOptIn !== 'boolean') {
    return res.status(400).json({ error: 'marketingOptIn must be a boolean' });
  }

  const db = getDb();
  const listenerId = req.tokenRow.listener_id;
  const existing = db.prepare(
    'SELECT id FROM listener_profiles WHERE account_id = ? ORDER BY created_at DESC LIMIT 1'
  ).get(listenerId);

  if (existing) {
    db.prepare('UPDATE listener_profiles SET marketing_opt_in = ? WHERE id = ?')
      .run(marketingOptIn ? 1 : 0, existing.id);
  } else {
    const account = db.prepare('SELECT email FROM listener_accounts WHERE id = ?').get(listenerId);
    db.prepare(
      'INSERT INTO listener_profiles (display_name, account_id, marketing_opt_in) VALUES (?, ?, ?)'
    ).run(account?.email || 'Listener', listenerId, marketingOptIn ? 1 : 0);
  }

  res.json({ ok: true, marketingOptIn });
});

// ─── Collection & purchases ──────────────────────────────────────────────────

// GET /api/listener/collection
// "Your Collection": every vault item this listener has unlocked — track
// unlocks, project unlocks, all-access, scoped tokens — resolved through the
// same ownership rules the library uses.
router.get('/collection', (req, res) => {
  if (!req.tokenRow) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const { buildOwnershipContext, isUnlockedInContext, formatItem } = require('./library');
  const db = getDb();
  const ctx = buildOwnershipContext(req);

  const vaultRows = db.prepare(
    "SELECT * FROM media WHERE is_active = 1 AND visibility = 'vault' ORDER BY indexed_at DESC"
  ).all();

  const items = vaultRows
    .filter(row => isUnlockedInContext(row, ctx))
    .map(row => formatItem(row, req.tier, ctx));

  res.json({ items, total: items.length });
});

// GET /api/listener/purchases
// Purchase history: this account's vault unlocks with what was paid and when.
// Only full accounts can have purchases (checkout requires one).
router.get('/purchases', (req, res) => {
  if (!req.tokenRow) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  if (!req.tokenRow.listener_id) {
    return res.json({ purchases: [] });
  }

  const rows = getDb().prepare(`
    SELECT vu.id, vu.unlock_type, vu.target_id, vu.amount_paid, vu.payment_type,
           vu.active, vu.expires_at, vu.created_at,
           m.title AS media_title, m.filename AS media_filename,
           vp.name AS project_name
    FROM vault_unlocks vu
    LEFT JOIN media m ON vu.unlock_type = 'track' AND m.id = vu.target_id
    LEFT JOIN vault_projects vp ON vu.unlock_type = 'project' AND vp.id = vu.target_id
    WHERE vu.listener_id = ?
    ORDER BY vu.created_at DESC
  `).all(req.tokenRow.listener_id);

  res.json({
    purchases: rows.map(r => ({
      id: r.id,
      unlockType: r.unlock_type,
      targetId: r.target_id,
      title: r.unlock_type === 'all_access'
        ? 'All-Access Vault'
        : (r.media_title || r.media_filename || r.project_name || null),
      amountPaidCents: r.amount_paid,
      paymentType: r.payment_type,
      active: r.active === 1,
      expiresAt: r.expires_at,
      createdAt: r.created_at,
    })),
  });
});

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
// Shared with the dashboard "generate reset link" route (no-SMTP fallback).
module.exports.createPasswordReset = createPasswordReset;
module.exports.resetLinkUrl = resetLinkUrl;
// Shared with the tip flow (src/api/payment.js): mint a login token, send the
// verification email, and issue a session for a tip-created account.
module.exports.issueToken = issueToken;
module.exports.createEmailToken = createEmailToken;
module.exports.verifyLinkUrl = verifyLinkUrl;
module.exports.autoLoginLinkUrl = autoLoginLinkUrl;
module.exports.AUTO_LOGIN_TTL_MINUTES = AUTO_LOGIN_TTL_MINUTES;
