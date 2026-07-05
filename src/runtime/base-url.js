const config = require('../config');

// The absolute origin listeners should use to reach this station. Prefers the
// configured public URL; falls back to the requesting host so links keep
// working on LAN/localhost installs that never set STATION_PUBLIC_URL.
function publicBaseUrl(req) {
  if (config.station.publicUrl) return config.station.publicUrl.replace(/\/+$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

module.exports = { publicBaseUrl };
