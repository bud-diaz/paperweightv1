const os = require('os');
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

// First non-internal IPv4 address bound to this machine, or null if there
// isn't one (e.g. a sandboxed/offline environment). Used only as a fallback
// for building a phone-reachable URL when the server is bound to all
// interfaces and no STATION_PUBLIC_URL is configured — a best-effort guess,
// not authoritative (a machine with multiple adapters may have several LAN
// IPs; set STATION_PUBLIC_URL explicitly for a stable, correct address).
function lanIPv4() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return null;
}

function localOrigin() {
  const host = config.host === '0.0.0.0' || config.host === '::'
    ? (lanIPv4() || 'localhost')
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
