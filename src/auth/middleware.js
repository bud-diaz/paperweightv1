const { validateToken } = require('./index');
const { getDb } = require('../db');
const config = require('../config');
const { isSubscriberTier, isHigherTier } = require('./access');

// Runs on every request. Sets req.tier = free | subscriber | pro | all_access.
// Accepts auth via cookie (web player) or Authorization: Bearer <token> header.
// Never blocks; it only annotates the request.
function attachTier(req, res, next) {
  let tokenStr = req.cookies?.pw_token;

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

  // Stripe-linked listener tokens are downgraded immediately when their latest
  // active subscription period is missing or expired.
  if (isSubscriberTier(row.tier) && row.listener_id) {
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

  // Creator-assigned tokens can upgrade listener accounts independent of Stripe.
  if (row.listener_id) {
    try {
      const assigned = getDb().prepare(`
        SELECT t.tier FROM token_assignments ta
        JOIN tokens t ON t.id = ta.token_id
        WHERE ta.listener_id = ? AND t.is_active = 1
      `).all(row.listener_id);
      for (const a of assigned) {
        if (isHigherTier(a.tier, req.tier)) {
          req.tier = a.tier;
        }
      }
    } catch {}
  }

  next();
}

function requireSubscriber(req, res, next) {
  if (!isSubscriberTier(req.tier)) {
    return res.status(403).json({ error: 'Subscriber access required' });
  }
  next();
}

function requireAllAccess(req, res, next) {
  if (req.tier !== 'all_access') {
    return res.status(403).json({ error: 'All-Access subscription required' });
  }
  next();
}

function requireDashboard(req, res, next) {
  const headerToken = req.headers['x-dashboard-token'];
  const hasValidToken =
    config.auth.dashboardToken &&
    headerToken === config.auth.dashboardToken;

  if (hasValidToken) return next();

  res.status(401).json({ error: 'Dashboard access denied' });
}

module.exports = { attachTier, requireSubscriber, requireAllAccess, requireDashboard };
