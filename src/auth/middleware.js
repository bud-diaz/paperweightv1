const { validateToken } = require('./index');
const config = require('../config');

// Runs on every request. Sets req.tier = 'free' | 'subscriber'.
// Never blocks — just annotates the request.
function attachTier(req, res, next) {
  const tokenStr = req.cookies?.pw_token;
  if (!tokenStr) {
    req.tier = 'free';
    return next();
  }
  const row = validateToken(tokenStr);
  req.tier = row ? row.tier : 'free';
  req.tokenRow = row || null;
  next();
}

// Blocks non-subscriber requests with 403.
function requireSubscriber(req, res, next) {
  if (req.tier !== 'subscriber') {
    return res.status(403).json({ error: 'Subscriber access required' });
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

module.exports = { attachTier, requireSubscriber, requireDashboard };
