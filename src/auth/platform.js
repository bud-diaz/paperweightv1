const config = require('../config');

// Separate from src/auth/access.js on purpose: access.js gates listener
// content tiers (free/subscriber/pro/all_access), this gates which creator
// dashboard features are available depending on deployment (desktop vs web).
function isDesktop() {
  return config.platform === 'desktop';
}

function requireDesktop(req, res, next) {
  if (!isDesktop()) {
    return res.status(403).json({ error: 'This feature is available in the Paperweight desktop app.' });
  }
  next();
}

module.exports = { isDesktop, requireDesktop };
