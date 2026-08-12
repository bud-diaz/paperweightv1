-- Migration 036: opinionated lifecycle recipes and a consent-aware delivery log.

CREATE TABLE IF NOT EXISTS automation_rules (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  template_key TEXT    NOT NULL UNIQUE,
  enabled      INTEGER NOT NULL DEFAULT 0,
  mode         TEXT    NOT NULL DEFAULT 'draft' CHECK(mode IN ('draft','automatic')),
  config       TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS automation_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id     INTEGER NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE,
  event_id    INTEGER REFERENCES audience_events(id) ON DELETE SET NULL,
  profile_id  INTEGER REFERENCES listener_profiles(id) ON DELETE SET NULL,
  listener_id INTEGER REFERENCES listener_accounts(id) ON DELETE SET NULL,
  status      TEXT    NOT NULL CHECK(status IN ('recommended','queued','sent','skipped','failed')),
  dedupe_key  TEXT    NOT NULL UNIQUE,
  explanation TEXT,
  last_error  TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  executed_at TEXT
);

CREATE TABLE IF NOT EXISTS delivery_outbox (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  channel         TEXT    NOT NULL CHECK(channel IN ('email','webhook')),
  profile_id      INTEGER REFERENCES listener_profiles(id) ON DELETE SET NULL,
  listener_id     INTEGER REFERENCES listener_accounts(id) ON DELETE SET NULL,
  recipient_email TEXT,
  subject         TEXT,
  body            TEXT    NOT NULL,
  payload         TEXT,
  status          TEXT    NOT NULL DEFAULT 'pending'
                  CHECK(status IN ('pending','sending','sent','failed','cancelled','suppressed')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  max_attempts    INTEGER NOT NULL DEFAULT 4,
  run_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  dedupe_key      TEXT    UNIQUE,
  last_error      TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  sent_at         TEXT
);

CREATE TABLE IF NOT EXISTS email_suppressions (
  email_hash TEXT PRIMARY KEY,
  reason     TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_automation_runs_status ON automation_runs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_delivery_outbox_due ON delivery_outbox(status, run_at);

INSERT OR IGNORE INTO automation_rules (template_key, enabled, mode) VALUES
  ('welcome_listener', 0, 'draft'),
  ('first_purchase_thanks', 0, 'draft'),
  ('release_affinity', 0, 'draft'),
  ('inactive_regular', 0, 'draft'),
  ('post_live_followup', 0, 'draft');
