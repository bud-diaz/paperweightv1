// Normalizes an incoming ISO-ish datetime string to SQLite's own datetime('now')
// format (UTC, 'YYYY-MM-DD HH:MM:SS') so stored values compare correctly
// against datetime('now') in plain SQL — no mixing of ISO 'T'/'Z' strings with
// SQLite's space-separated format.
function toSqliteDatetime(value) {
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

module.exports = { toSqliteDatetime };
