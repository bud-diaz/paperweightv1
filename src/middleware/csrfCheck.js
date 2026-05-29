const config = require('../config');

// Mutating HTTP methods that carry a session cookie and originate from the browser.
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Extracts the bare origin (scheme + host) from a full URL string.
function parseOrigin(url) {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

// Returns the expected set of allowed origins for this station.
// Always includes localhost variants so the local dashboard keeps working.
function allowedOrigins(req) {
  const origins = new Set([
    `http://localhost:${config.port}`,
    `http://127.0.0.1:${config.port}`,
  ]);

  if (config.station.publicUrl) {
    const pub = parseOrigin(config.station.publicUrl);
    if (pub) origins.add(pub);
  }

  // Allow same-origin requests where the host header matches
  if (req.headers.host) {
    const scheme = config.https ? 'https' : 'http';
    origins.add(`${scheme}://${req.headers.host}`);
  }

  return origins;
}

// Middleware that blocks cross-origin state-changing requests that arrive with a
// session cookie. Mobile clients send Bearer tokens and never set pw_token cookies,
// so this check only fires for browser-originated cookie requests.
//
// Strategy: check Origin header (modern browsers always send it on cross-origin
// requests). Fall back to Referer for older browsers. Pass through if neither
// header is present — that covers direct curl / server-to-server calls.
function csrfCheck(req, res, next) {
  // Only check unsafe methods
  if (!UNSAFE_METHODS.has(req.method)) return next();

  // Only check requests carrying a session cookie (browser web flow)
  if (!req.cookies?.pw_token) return next();

  const originHeader = req.headers.origin;
  const refererHeader = req.headers.referer;
  const source = originHeader || (refererHeader ? parseOrigin(refererHeader) : null);

  // If no origin/referer at all, let it through — curl, native mobile, server-to-server
  if (!source) return next();

  if (allowedOrigins(req).has(source)) return next();

  return res.status(403).json({ error: 'Cross-origin request blocked' });
}

module.exports = { csrfCheck };
