const { validateToken } = require('./index');
const config = require('../config');

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
  req.tier = row ? row.tier : 'free';
  req.tokenRow = row || null;
  next();
}

// Subscriber tiers — includes legacy 'subscriber' and v1.5 named tiers.
const SUBSCRIBER_TIERS = new Set(['subscriber', 'pro', 'all_access']);

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

// Protects dashboard routes.
// Allows: localhost OR a valid X-Dashboard-Token header.
function requireDashboard(req, res, next) {
  const LOCAL_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
  const isLocal = LOCAL_IPS.has(req.ip) || LOCAL_IPS.has(req.socket?.remoteAddress);

  const headerToken = req.headers['x-dashboard-token'];
  const hasValidToken =
    config.auth.dashboardToken &&
    headerToken === config.auth.dashboardToken;

  if (isLocal || hasValidToken) return next();

  res.status(401).json({ error: 'Dashboard access denied' });
}

module.exports = { attachTier, requireSubscriber, requireAllAccess, requireDashboard };
