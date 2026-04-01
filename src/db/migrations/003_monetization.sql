-- Migration 003: Monetization layer for Paperweight v1.5
-- Adds listener accounts, subscriptions, download tokens, saved stations.
-- Also extends the existing tokens table with a listener_id FK.
-- All changes are additive — existing tables and rows are untouched.

-- NOTE: ALTER TABLE tokens ADD COLUMN listener_id is handled in the Node
-- migration runner (src/db/index.js) so it can be gated on column existence.
-- SQLite has no IF NOT EXISTS for ALTER TABLE.

-- Listener accounts (separate from creator accounts)
CREATE TABLE IF NOT EXISTS listener_accounts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  is_active     INTEGER NOT NULL DEFAULT 1
);

-- Active and historical subscriptions per listener
CREATE TABLE IF NOT EXISTS subscriptions (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  listener_id              INTEGER NOT NULL REFERENCES listener_accounts(id),
  tier                     TEXT    NOT NULL CHECK(tier IN ('pro', 'all_access')),
  provider                 TEXT    NOT NULL CHECK(provider IN ('stripe', 'paypal')),
  provider_subscription_id TEXT    NOT NULL,
  status                   TEXT    NOT NULL CHECK(status IN ('active', 'cancelled', 'expired')),
  current_period_end       TEXT    NOT NULL,
  created_at               TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Signed download tokens issued to all_access subscribers (48h expiry)
CREATE TABLE IF NOT EXISTS download_tokens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  media_id    INTEGER NOT NULL REFERENCES media(id),
  listener_id INTEGER NOT NULL REFERENCES listener_accounts(id),
  token       TEXT    NOT NULL UNIQUE,
  expires_at  TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Stations saved by listeners (server-side, synced to account)
CREATE TABLE IF NOT EXISTS listener_saved_stations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  listener_id INTEGER NOT NULL REFERENCES listener_accounts(id),
  core_url    TEXT    NOT NULL,
  slug        TEXT    NOT NULL,
  name        TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(listener_id, core_url, slug)
);

CREATE INDEX IF NOT EXISTS idx_listener_accounts_email  ON listener_accounts(email);
CREATE INDEX IF NOT EXISTS idx_subscriptions_listener   ON subscriptions(listener_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status     ON subscriptions(listener_id, status);
CREATE INDEX IF NOT EXISTS idx_download_tokens_token    ON download_tokens(token);
CREATE INDEX IF NOT EXISTS idx_download_tokens_listener ON download_tokens(listener_id, media_id);
CREATE INDEX IF NOT EXISTS idx_saved_stations_listener  ON listener_saved_stations(listener_id);
