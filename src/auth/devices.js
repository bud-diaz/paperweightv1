// Authorized dashboard devices — persistent, individually revocable Studio
// sessions for paired mobile devices. Distinct from src/auth/sessions.js
// (the in-memory, restart-cleared session used by the primary desktop
// token/2FA login): a paired device's credential lives in the
// dashboard_devices table so it survives a server restart.

const crypto = require('crypto');
const { getDb } = require('../db');

function generateDeviceToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Only the SHA-256 hash is ever persisted; the raw token is returned once to
// set as the pw_dashboard_session cookie value and never stored.
function hashDeviceToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function createDeviceSession(label) {
  const token = generateDeviceToken();
  const tokenHash = hashDeviceToken(token);
  getDb().prepare(
    'INSERT INTO dashboard_devices (label, token_hash) VALUES (?, ?)'
  ).run(label || 'Unnamed device', tokenHash);
  return token;
}

// Returns the device row if the token matches an unrevoked device, null
// otherwise. Bumps last_used_at on a valid hit.
function validateDeviceSession(tokenStr) {
  if (!tokenStr || typeof tokenStr !== 'string') return null;
  const db = getDb();
  const row = db.prepare(
    'SELECT * FROM dashboard_devices WHERE token_hash = ? AND revoked_at IS NULL'
  ).get(hashDeviceToken(tokenStr));
  if (row) {
    db.prepare("UPDATE dashboard_devices SET last_used_at = datetime('now') WHERE id = ?").run(row.id);
  }
  return row || null;
}

function listDevices() {
  return getDb().prepare(
    'SELECT id, label, created_at, last_used_at, revoked_at FROM dashboard_devices ORDER BY created_at DESC'
  ).all();
}

function revokeDevice(id) {
  getDb().prepare("UPDATE dashboard_devices SET revoked_at = datetime('now') WHERE id = ? AND revoked_at IS NULL").run(id);
}

function renameDevice(id, label) {
  getDb().prepare('UPDATE dashboard_devices SET label = ? WHERE id = ?').run(String(label).slice(0, 100), id);
}

module.exports = {
  createDeviceSession,
  validateDeviceSession,
  listDevices,
  revokeDevice,
  renameDevice,
};
