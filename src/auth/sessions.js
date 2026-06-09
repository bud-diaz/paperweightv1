// In-memory dashboard session manager.
// Sessions are intentionally cleared on server restart — the creator re-auths
// after a restart, which is acceptable for a self-hosted single-user station.

const crypto = require('crypto');

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const sessions = new Map();

function createSession() {
  pruneExpired();
  const id = crypto.randomBytes(32).toString('hex');
  sessions.set(id, {
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
  return id;
}

function validateSession(id) {
  if (typeof id !== 'string' || !id) return false;
  const s = sessions.get(id);
  if (!s) return false;
  if (Date.now() > s.expiresAt) {
    sessions.delete(id);
    return false;
  }
  s.lastUsedAt = Date.now();
  return true;
}

function deleteSession(id) {
  if (id) sessions.delete(id);
}

function pruneExpired() {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now > s.expiresAt) sessions.delete(id);
  }
}

module.exports = { createSession, validateSession, deleteSession };
