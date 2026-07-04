-- Migration 023: Listener password reset tokens
-- Only a SHA-256 hash of the reset token is stored; the raw value lives in the
-- emailed (or creator-copied) link. created_via distinguishes listener-requested
-- email resets from links the creator generated in the dashboard for
-- installs without SMTP configured.

CREATE TABLE IF NOT EXISTS password_resets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  listener_id INTEGER NOT NULL REFERENCES listener_accounts(id) ON DELETE CASCADE,
  token_hash  TEXT    NOT NULL UNIQUE,
  created_via TEXT    NOT NULL DEFAULT 'email' CHECK(created_via IN ('email', 'dashboard')),
  expires_at  TEXT    NOT NULL,
  used_at     TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_password_resets_listener ON password_resets(listener_id);
