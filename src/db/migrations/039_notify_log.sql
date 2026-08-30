-- Migration 039: Outbound notify webhook log
-- Backs the mobile Studio "Notifications" essentials screen: a viewable
-- history of the go-live/new-post/media-release Discord-compatible webhook
-- pings fired by src/notify/index.js, which was previously fire-and-forget
-- with no persistence (only written to the server log file). Pruned to the
-- most recent 200 rows in application code (src/notify/index.js), not here.

CREATE TABLE IF NOT EXISTS notify_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  context    TEXT    NOT NULL,
  content    TEXT    NOT NULL,
  status     TEXT    NOT NULL CHECK (status IN ('sent','failed','skipped')),
  error_msg  TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notify_log_created_at ON notify_log(created_at DESC);
