-- Migration 022: Download click/event analytics
-- Records gated landing-page download attempts separately from email leads so
-- launch promotion can measure source/platform/version/referrer performance.

CREATE TABLE IF NOT EXISTS download_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT,
  platform   TEXT    NOT NULL,
  artifact   TEXT,
  version    TEXT,
  source     TEXT,
  medium     TEXT,
  campaign   TEXT,
  referrer   TEXT,
  ip_hash    TEXT,
  user_agent TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_download_events_created ON download_events(created_at);
CREATE INDEX IF NOT EXISTS idx_download_events_platform ON download_events(platform, created_at);
CREATE INDEX IF NOT EXISTS idx_download_events_campaign ON download_events(source, campaign, created_at);
