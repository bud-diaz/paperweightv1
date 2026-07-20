// Short-lived, in-memory pairing tokens for the mobile Studio "authorized
// device" flow. Mirrors the pendingChallenges Map pattern in src/api/auth.js:
// TTL + hard cap + prune-on-insert. These are deliberately not persisted —
// unlike the long-lived credential a successful pairing produces (see
// src/auth/devices.js), a pairing token is a short bootstrap secret that's
// fine to lose on a restart, same as an in-flight 2FA challenge.

const crypto = require('crypto');

const PAIRING_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_PENDING_PAIRINGS = 20;

const pendingPairings = new Map();

function pruneExpired() {
  const now = Date.now();
  for (const [token, p] of pendingPairings) {
    if (now > p.expiresAt) pendingPairings.delete(token);
  }
}

// Generates a new pairing token in 'pending' status. Only reachable from an
// already-authenticated Studio session (requireDashboard-gated route).
function createPairing() {
  pruneExpired();
  while (pendingPairings.size >= MAX_PENDING_PAIRINGS) {
    pendingPairings.delete(pendingPairings.keys().next().value);
  }
  const token = crypto.randomBytes(24).toString('hex');
  const expiresAt = Date.now() + PAIRING_TTL_MS;
  pendingPairings.set(token, { status: 'pending', createdAt: Date.now(), expiresAt });
  return { pairToken: token, expiresAt };
}

// Read-only status check for the desktop's poll — never consumes the token.
function getPairingStatus(pairToken) {
  const p = pendingPairings.get(pairToken);
  if (!p || Date.now() > p.expiresAt) return null;
  return { status: p.status };
}

// Single-use consume, called by the unauthenticated redeem endpoint. Returns
// true if this call is the one that claims it, false if already claimed,
// expired, or unknown.
function claimPairing(pairToken) {
  const p = pendingPairings.get(pairToken);
  if (!p || Date.now() > p.expiresAt || p.status !== 'pending') return false;
  p.status = 'claimed';
  return true;
}

module.exports = { createPairing, getPairingStatus, claimPairing };
