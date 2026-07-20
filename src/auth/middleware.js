const { validateToken } = require('./index');
const { getDb } = require('../db');
const config = require('../config');
const crypto = require('crypto');
const { isSubscriberTier, isHigherTier } = require('./access');
const { validateSession } = require('./sessions');
const { validateDeviceSession } = require('./devices');

// Constant-time string compare that does not early-return on length mismatch.
// timingSafeEqual requires equal-length buffers, so hash both sides first.
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

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

  req.tier = effectiveTierForTokenRow(row);

  // Only fetched for subscriber+ tiers — free-tier requests have nothing to
  // gate, so this stays off the hot path for the vast majority of traffic.
  if (isSubscriberTier(req.tier) && row.listener_id) {
    try {
      const account = getDb().prepare(
        'SELECT email_verified_at, email_verification_required_at FROM listener_accounts WHERE id = ?'
      ).get(row.listener_id);
      if (account) {
        req.emailVerification = {
          verifiedAt: account.email_verified_at,
          requiredAt: account.email_verification_required_at,
        };
      }
    } catch {
      // Fail open — don't lock out a paid listener over a transient DB hiccup.
    }
  }

  next();
}

function activeSubscriptionTierForListener(listenerId) {
  if (!listenerId) return null;
  const rows = getDb().prepare(
    "SELECT tier, current_period_end FROM subscriptions WHERE listener_id = ? AND status = 'active' ORDER BY created_at DESC"
  ).all(listenerId);
  let best = null;
  const nowMs = Date.now();
  for (const row of rows) {
    const expiresAt = new Date(row.current_period_end).getTime();
    if (!Number.isFinite(expiresAt) || expiresAt <= nowMs) continue;
    if (!best || isHigherTier(row.tier, best)) {
      best = row.tier;
    }
  }
  return best;
}

function effectiveTierForTokenRow(row) {
  if (!row) return 'free';
  let tier = row.tier || 'free';

  // Listener tokens reflect the account's unexpired active subscription:
  // stale paid tokens downgrade, while free login tokens can upgrade.
  if (row.listener_id) {
    try {
      const subscriptionTier = activeSubscriptionTierForListener(row.listener_id);
      if (isSubscriberTier(row.tier)) {
        tier = subscriptionTier || 'free';
      } else if (subscriptionTier && isHigherTier(subscriptionTier, tier)) {
        tier = subscriptionTier;
      }
    } catch {
      // Preserve row.tier on DB errors. This avoids locking out a paid token
      // during a transient DB hiccup, while free tokens remain free.
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
        if (isHigherTier(a.tier, tier)) {
          tier = a.tier;
        }
      }
    } catch {}
  }

  return tier;
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

function hasDashboardSession(req) {
  const sessionId = req.cookies?.pw_dashboard_session;
  return !!sessionId && (validateSession(sessionId) || validateDeviceSession(sessionId));
}

function requireDashboard(req, res, next) {
  // Session cookie set after successful login (required when 2FA is enabled;
  // also works when 2FA is disabled to avoid replaying the token on every request).
  if (hasDashboardSession(req)) return next();

  // Direct token header, accepted only when 2FA is disabled.
  const headerToken = req.headers['x-dashboard-token'];
  const hasValidToken =
    !!config.auth.dashboardToken &&
    safeEqual(String(headerToken || ''), config.auth.dashboardToken);

  if (hasValidToken) {
    try {
      const row = getDb().prepare('SELECT enabled FROM dashboard_2fa WHERE id = 1').get();
      if (row && row.enabled) {
        return res.status(401).json({ error: 'Dashboard access denied', requires2FA: true });
      }
    } catch {}
    return next();
  }

  res.status(401).json({ error: 'Dashboard access denied' });
}

module.exports = {
  attachTier,
  effectiveTierForTokenRow,
  requireSubscriber,
  requireAllAccess,
  requireDashboard,
  hasDashboardSession,
  activeSubscriptionTierForListener,
};
