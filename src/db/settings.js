const { getDb } = require('./index');

// Thin accessors over the app_settings key/value table (migration 024).
// Values are stored as strings; callers own their own parsing.

function getSetting(key, fallback = null) {
  const row = getDb().prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  getDb().prepare(`
    INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, value === null || value === undefined ? null : String(value));
}

function getBoolSetting(key, fallback = false) {
  const value = getSetting(key);
  if (value === null) return fallback;
  return value === '1' || value === 'true';
}

module.exports = { getSetting, setSetting, getBoolSetting };
