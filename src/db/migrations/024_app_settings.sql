-- Migration 024: Generic key/value settings store
-- Small creator-configurable flags that don't warrant their own single-row
-- table: notify webhook URL, post email notifications, RSS feed enablement.

CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
