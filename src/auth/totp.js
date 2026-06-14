// TOTP implementation using only Node built-in crypto (RFC 6238 / RFC 4226).
// No external dependencies.

const crypto = require('crypto');

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let result = '';
  let bits = 0;
  let acc = 0;
  for (const byte of buf) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += BASE32[(acc >> bits) & 31];
    }
  }
  if (bits > 0) result += BASE32[(acc << (5 - bits)) & 31];
  return result;
}

function base32Decode(str) {
  const s = str.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  const bytes = [];
  let bits = 0;
  let acc = 0;
  for (const ch of s) {
    const idx = BASE32.indexOf(ch);
    if (idx < 0) continue;
    acc = (acc << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((acc >> bits) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

function computeTOTP(secret, counter) {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  // Write counter as 8-byte big-endian uint64
  const hi = Math.floor(counter / 0x100000000);
  const lo = counter >>> 0;
  buf.writeUInt32BE(hi, 0);
  buf.writeUInt32BE(lo, 4);
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) * 0x1000000 +
      hmac[offset + 1] * 0x10000 +
      hmac[offset + 2] * 0x100 +
      hmac[offset + 3]) %
    1_000_000;
  return String(code).padStart(6, '0');
}

// tolerance: how many 30s windows either side to accept (handles clock skew)
function verifyTOTP(secret, code, tolerance = 1) {
  const codeStr = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(codeStr)) return false;
  const counter = Math.floor(Date.now() / 1000 / 30);
  for (let i = -tolerance; i <= tolerance; i++) {
    if (computeTOTP(secret, counter + i) === codeStr) return true;
  }
  return false;
}

function generateSecret(bytes = 20) {
  return base32Encode(crypto.randomBytes(bytes));
}

function getOtpauthUri(secret, stationName) {
  const label = encodeURIComponent(`Paperweight:${stationName || 'Studio'}`);
  const issuer = encodeURIComponent('Paperweight');
  return `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
}

// Generates n one-time recovery codes in XXXX-XXXX-XXXX format.
function generateRecoveryCodes(n = 8) {
  return Array.from({ length: n }, () => {
    const hex = crypto.randomBytes(6).toString('hex').toUpperCase();
    return `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`;
  });
}

function hashCode(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

module.exports = { generateSecret, verifyTOTP, getOtpauthUri, generateRecoveryCodes, hashCode };
