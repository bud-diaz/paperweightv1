const crypto = require('crypto');
const { getDb } = require('../db');

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

const VALID_TIERS = ['subscriber', 'pro', 'all_access'];

function createToken(label, tier = 'subscriber') {
  const safeTier = VALID_TIERS.includes(tier) ? tier : 'subscriber';
  const token = generateToken();
  getDb().prepare(
    'INSERT INTO tokens (token, label, tier) VALUES (?, ?, ?)'
  ).run(token, label || null, safeTier);
  return token;
}

function updateTokenTier(id, tier) {
  if (!VALID_TIERS.includes(tier)) throw new Error('Invalid tier');
  getDb().prepare(
    "UPDATE tokens SET tier = ?, updated_at = datetime('now') WHERE id = ? AND is_active = 1"
  ).run(tier, id);
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

module.exports = { createToken, validateToken, revokeToken, listTokens, updateTokenTier };
