const config = require('../config');

// Guards routes that exist only to serve the future Paperweight Cloud phase —
// the native-app deep-link checkout flow and the multi-station directory.
// They are inert in the self-hosted build unless PAPERWEIGHT_CLOUD=true.
//
// Responds 404 (not 403/503) so the surface is invisible: these are not features
// of the current product, and an unauthenticated probe should not learn they exist.
function cloudOnly(req, res, next) {
  if (config.cloud.enabled) return next();
  return res.status(404).json({ error: 'Not found' });
}

module.exports = { cloudOnly };
