-- Migration 034: creator state for deterministic Today recommendations.

CREATE TABLE IF NOT EXISTS insight_state (
  insight_key     TEXT PRIMARY KEY,
  status          TEXT NOT NULL DEFAULT 'active'
                  CHECK(status IN ('active','dismissed','snoozed','completed')),
  first_seen_at   TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at    TEXT NOT NULL DEFAULT (datetime('now')),
  dismissed_until TEXT,
  metadata        TEXT
);
