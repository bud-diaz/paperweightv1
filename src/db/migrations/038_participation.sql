-- Migration 038: bounded, moderated fan participation.

CREATE TABLE IF NOT EXISTS listener_requests (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id  INTEGER REFERENCES listener_profiles(id) ON DELETE SET NULL,
  listener_id INTEGER REFERENCES listener_accounts(id) ON DELETE SET NULL,
  media_id    INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  dedication  TEXT,
  status      TEXT    NOT NULL DEFAULT 'pending'
              CHECK(status IN ('pending','accepted','played','declined')),
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS polls (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  question   TEXT    NOT NULL,
  status     TEXT    NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','open','closed')),
  opens_at   TEXT,
  closes_at  TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS poll_options (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  poll_id    INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  label      TEXT    NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS poll_votes (
  poll_id     INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  option_id   INTEGER NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
  profile_id  INTEGER REFERENCES listener_profiles(id) ON DELETE CASCADE,
  listener_id INTEGER REFERENCES listener_accounts(id) ON DELETE CASCADE,
  identity_key TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (poll_id, identity_key)
);

CREATE TABLE IF NOT EXISTS premiere_reminders (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES release_campaigns(id) ON DELETE CASCADE,
  profile_id  INTEGER REFERENCES listener_profiles(id) ON DELETE CASCADE,
  listener_id INTEGER REFERENCES listener_accounts(id) ON DELETE CASCADE,
  email       TEXT    NOT NULL,
  sent_at     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(campaign_id, email)
);

CREATE INDEX IF NOT EXISTS idx_listener_requests_status ON listener_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_polls_status ON polls(status, opens_at, closes_at);
