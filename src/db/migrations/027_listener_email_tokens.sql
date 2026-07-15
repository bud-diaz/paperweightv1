-- Migration 027: Listener email tokens
-- One table backs two hash-only, single-use link mechanisms: verifying a
-- listener's email address (purpose = 'verify') and the auto-login link sent
-- when a tip includes a donor email (purpose = 'login'). Only a SHA-256 hash
-- of the raw token is stored, matching the password_resets pattern (024) —
-- the raw value lives only in the emailed link fragment.

CREATE TABLE IF NOT EXISTS listener_email_tokens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  listener_id INTEGER NOT NULL REFERENCES listener_accounts(id) ON DELETE CASCADE,
  token_hash  TEXT    NOT NULL UNIQUE,
  purpose     TEXT    NOT NULL CHECK(purpose IN ('verify', 'login')),
  expires_at  TEXT    NOT NULL,
  used_at     TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_listener_email_tokens_listener ON listener_email_tokens(listener_id);
