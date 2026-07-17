const net = require('net');
const dns = require('dns').promises;

// True for loopback, private, link-local (incl. cloud metadata 169.254.169.254),
// unique-local, and other non-public ranges this server must not be tricked into
// reaching via an owner-supplied URL (station health ping, notify webhooks).
function isBlockedAddress(ip) {
  const type = net.isIP(ip);
  if (type === 4) {
    const p = ip.split('.').map(Number);
    if (p.some(o => Number.isNaN(o))) return true;
    if (p[0] === 0 || p[0] === 127 || p[0] === 10) return true;            // 0/8, loopback, 10/8
    if (p[0] === 169 && p[1] === 254) return true;                          // link-local + metadata
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;             // 172.16/12
    if (p[0] === 192 && p[1] === 168) return true;                          // 192.168/16
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true;            // CGNAT 100.64/10
    return false;
  }
  if (type === 6) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::') return true;                             // loopback / unspecified
    if (v.startsWith('fe80') || v.startsWith('fc') || v.startsWith('fd')) return true; // link-local / ULA
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);               // IPv4-mapped
    if (mapped) return isBlockedAddress(mapped[1]);
    return false;
  }
  return true; // not a recognizable IP literal — refuse
}

// Resolves a hostname once and returns the validated address to connect to,
// or null if it's invalid/unresolvable/blocked. Callers MUST pin their actual
// connection to this address (e.g. via a custom `lookup` on http(s).request)
// instead of letting the request re-resolve the hostname — otherwise a
// short-TTL DNS record on an attacker-controlled domain can answer with a
// public address for this check and a private/metadata address moments later
// for the real connection (DNS rebinding).
async function resolveSafeAddress(hostname) {
  try {
    if (net.isIP(hostname)) {
      return isBlockedAddress(hostname) ? null : { address: hostname, family: net.isIP(hostname) };
    }
    const resolved = await dns.lookup(hostname, { all: true });
    if (resolved.length === 0 || resolved.some(r => isBlockedAddress(r.address))) return null;
    return resolved[0];
  } catch {
    return null;
  }
}

module.exports = { isBlockedAddress, resolveSafeAddress };
