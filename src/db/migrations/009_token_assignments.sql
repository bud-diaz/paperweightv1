-- Migration 009: Token account assignments
-- Allows a single creator-issued token to be assigned to multiple listener accounts.
-- When a listener logs in, their tier is upgraded to the highest-tier assigned token.

CREATE TABLE IF NOT EXISTS token_assignments (
  token_id    INTEGER NOT NULL REFERENCES tokens(id)            ON DELETE CASCADE,
  listener_id INTEGER NOT NULL REFERENCES listener_accounts(id) ON DELETE CASCADE,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (token_id, listener_id)
);

CREATE INDEX IF NOT EXISTS idx_token_assignments_listener ON token_assignments(listener_id);
