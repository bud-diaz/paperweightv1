const { validateToken } = require('./index');
const { getDb } = require('../db');
const config = require('../config');

// Subscriber tiers — includes legacy 'subscriber' and v1.5 named tiers.
const SUBSCRIBER_TIERS = new Set(['subscriber', 'pro', 'all_access']);

// Runs on every request. Sets req.tier = 'free' | 'subscriber' | 'pro' | 'all_access'.
// Accepts auth via cookie (web player) or Authorization: Bearer <token> header (mobile).
// Never blocks — just annotates the request.
function attachTier(req, res, next) {
  let tokenStr = req.cookies?.pw_token;

  // Bearer token fallback for mobile clients that cannot use httpOnly cookies
  if (!tokenStr) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      tokenStr = authHeader.slice(7).trim();
    }
  }

  if (!tokenStr) {
    req.tier = 'free';
    return next();
  }

  const row = validateToken(tokenStr);
  req.tokenRow = row || null;

  if (!row) {
    req.tier = 'free';
    return next();
  }

  req.tier = row.tier;

  // Real-time subscription expiry check for Stripe-issued tokens.
  // Tokens linked to a listener_id are validated against subscriptions.current_period_end —
  // even if the webhook hasn't fired yet, an expired period downgrades to free immediately.
  // Creator-issued invite tokens (no listener_id) are trusted as-is.
  if (SUBSCRIBER_TIERS.has(row.tier) && row.listener_id) {
    try {
      const sub = getDb().prepare(
        "SELECT current_period_end FROM subscriptions WHERE listener_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1"
      ).get(row.listener_id);
      if (!sub || new Date(sub.current_period_end) < new Date()) {
        req.tier = 'free';
      }
    } catch {
      req.tier = 'free';
    }
  }

  next();
}

// Blocks non-subscriber requests with 403.
function requireSubscriber(req, res, next) {
  if (!SUBSCRIBER_TIERS.has(req.tier)) {
    return res.status(403).json({ error: 'Subscriber access required' });
  }
  next();
}

// Blocks requests that are not all_access tier (downloads only).
function requireAllAccess(req, res, next) {
  if (req.tier !== 'all_access') {
    return res.status(403).json({ error: 'All-Access subscription required' });
  }
  next();
}

// Protects dashboard routes. Always requires a valid X-Dashboard-Token header.
function requireDashboard(req, res, next) {
  const headerToken = req.headers['x-dashboard-token'];
  const hasValidToken =
    config.auth.dashboardToken &&
    headerToken === config.auth.dashboardToken;

  if (hasValidToken) return next();

  res.status(401).json({ error: 'Dashboard access denied' });
}

module.exports = { attachTier, requireSubscriber, requireAllAccess, requireDashboard };
