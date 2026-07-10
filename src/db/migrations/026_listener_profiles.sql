-- Migration 026: Lightweight listener profiles (welcome-page onboarding)
-- A listener can enter with just a display name; email is optional and only
-- ever used for marketing when marketing_opt_in = 1. Profiles are keyed to the
-- pw_token issued at entry (token_id) and linked to a full listener_accounts
-- row (account_id) if the listener later completes an account to buy or
-- subscribe. listener_accounts is intentionally untouched: its email/password
-- NOT NULL constraints would need a table rebuild, which automatically applied
-- migrations must not do.

CREATE TABLE IF NOT EXISTS listener_profiles (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  display_name     TEXT    NOT NULL,
  email            TEXT,
  marketing_opt_in INTEGER NOT NULL DEFAULT 0,
  account_id       INTEGER REFERENCES listener_accounts(id),
  token_id         INTEGER REFERENCES tokens(id),
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  last_seen_at     TEXT
);

CREATE INDEX IF NOT EXISTS idx_listener_profiles_token   ON listener_profiles(token_id);
CREATE INDEX IF NOT EXISTS idx_listener_profiles_account ON listener_profiles(account_id);
