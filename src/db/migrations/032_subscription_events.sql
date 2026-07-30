-- Migration 032: immutable subscription lifecycle history.

CREATE TABLE IF NOT EXISTS subscription_events (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription_id          INTEGER,
  listener_id              INTEGER NOT NULL REFERENCES listener_accounts(id),
  event_type               TEXT    NOT NULL,
  tier                     TEXT,
  status                   TEXT,
  amount_cents             INTEGER,
  currency                 TEXT,
  billing_interval         TEXT,
  provider                 TEXT    NOT NULL,
  provider_event_id        TEXT,
  provider_subscription_id TEXT,
  dedupe_key               TEXT    UNIQUE,
  occurred_at              TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_subscription_events_listener ON subscription_events(listener_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_subscription_events_type ON subscription_events(event_type, occurred_at DESC);
