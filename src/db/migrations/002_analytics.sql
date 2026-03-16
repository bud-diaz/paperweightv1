CREATE TABLE IF NOT EXISTS listen_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ip_hash     TEXT    NOT NULL,
  media_id    INTEGER REFERENCES media(id),
  started_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  seconds     INTEGER DEFAULT 0,
  tier        TEXT    NOT NULL DEFAULT 'free'
);

CREATE TABLE IF NOT EXISTS daily_stats (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  date             TEXT    NOT NULL UNIQUE,
  unique_listeners INTEGER DEFAULT 0,
  total_listen_sec INTEGER DEFAULT 0,
  top_media_id     INTEGER REFERENCES media(id)
);

CREATE TABLE IF NOT EXISTS system_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  level       TEXT    NOT NULL,
  component   TEXT    NOT NULL,
  message     TEXT    NOT NULL,
  occurred_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_listen_events_media ON listen_events(media_id);
CREATE INDEX IF NOT EXISTS idx_listen_events_date  ON listen_events(started_at);
CREATE INDEX IF NOT EXISTS idx_system_log_level    ON system_log(level, occurred_at);
