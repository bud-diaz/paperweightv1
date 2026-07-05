const config = require('../config');

function originFrom(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

function configuredPublicOrigin() {
  if (!config.station.publicUrl) return null;
  return originFrom(config.station.publicUrl);
}

function localOrigin() {
  const host = config.host === '0.0.0.0' || config.host === '::'
    ? 'localhost'
    : config.host;
  const needsBrackets = host.includes(':') && !host.startsWith('[');
  const hostname = needsBrackets ? `[${host}]` : host;
  const scheme = config.https ? 'https' : 'http';
  return `${scheme}://${hostname}:${config.port}`;
}

// The absolute origin listeners should use to reach this station. It never
// trusts arbitrary request Host headers for security-sensitive links.
function publicBaseUrl() {
  return configuredPublicOrigin() || localOrigin();
}

function allowedStationOrigins() {
  const origins = new Set([
    `http://localhost:${config.port}`,
    `http://127.0.0.1:${config.port}`,
    localOrigin(),
  ]);

  const pub = configuredPublicOrigin();
  if (pub) origins.add(pub);

  return origins;
}

function isValidExternalHttpUrl(raw) {
  if (!raw || typeof raw !== 'string') return false;
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

module.exports = {
  publicBaseUrl,
  allowedStationOrigins,
  isValidExternalHttpUrl,
};
