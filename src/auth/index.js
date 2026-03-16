const crypto = require('crypto');
const { getDb } = require('../db');

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function createToken(label) {
  const token = generateToken();
  getDb().prepare(
    "INSERT INTO tokens (token, label, tier) VALUES (?, ?, 'subscriber')"
  ).run(token, label || null);
  return token;
}

// Returns the token row if valid and active, null otherwise.
// Also bumps last_used on a valid hit.
function validateToken(tokenStr) {
  if (!tokenStr || typeof tokenStr !== 'string') return null;
  const db = getDb();
  const row = db.prepare(
    'SELECT * FROM tokens WHERE token = ? AND is_active = 1'
  ).get(tokenStr);
  if (row) {
    db.prepare("UPDATE tokens SET last_used = datetime('now') WHERE id = ?").run(row.id);
  }
  return row || null;
}

function revokeToken(id) {
  getDb().prepare('UPDATE tokens SET is_active = 0 WHERE id = ?').run(id);
}

function listTokens() {
  return getDb().prepare(
    'SELECT id, label, tier, created_at, last_used, is_active FROM tokens ORDER BY created_at DESC'
  ).all();
}

module.exports = { createToken, validateToken, revokeToken, listTokens };
