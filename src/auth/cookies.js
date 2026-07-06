const config = require('../config');

const LISTENER_COOKIE_NAME = 'pw_token';
const LISTENER_COOKIE_MAX_AGE = 365 * 24 * 60 * 60 * 1000;

function listenerCookieOpts(req, { maxAge = LISTENER_COOKIE_MAX_AGE, sameSite = 'Strict' } = {}) {
  return {
    httpOnly: true,
    secure: config.https || !!(req && req.secure),
    sameSite,
    maxAge,
  };
}

function clearListenerCookie(res, req, opts = {}) {
  const { maxAge, ...clearOpts } = listenerCookieOpts(req, opts);
  res.clearCookie(LISTENER_COOKIE_NAME, clearOpts);
}

module.exports = {
  LISTENER_COOKIE_NAME,
  listenerCookieOpts,
  clearListenerCookie,
};
