-- Migration 031: identified audience activity and durable relationship history.
-- Anonymous listeners remain aggregate-only in listen_events. audience_events
-- stores no IP address or browser fingerprint.

CREATE TABLE IF NOT EXISTS audience_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type  TEXT    NOT NULL,
  profile_id  INTEGER REFERENCES listener_profiles(id) ON DELETE SET NULL,
  listener_id INTEGER REFERENCES listener_accounts(id) ON DELETE SET NULL,
  media_id    INTEGER REFERENCES media(id) ON DELETE SET NULL,
  project_id  INTEGER REFERENCES vault_projects(id) ON DELETE SET NULL,
  post_id     INTEGER REFERENCES creator_posts(id) ON DELETE SET NULL,
  source      TEXT,
  value_cents INTEGER,
  currency    TEXT,
  dedupe_key  TEXT UNIQUE,
  metadata    TEXT,
  occurred_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audience_events_profile ON audience_events(profile_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audience_events_listener ON audience_events(listener_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audience_events_type ON audience_events(event_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audience_events_media ON audience_events(media_id, occurred_at DESC);
