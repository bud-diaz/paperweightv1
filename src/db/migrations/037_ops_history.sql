-- Migration 037: bounded local operational history and recovery confidence.

CREATE TABLE IF NOT EXISTS ops_checks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  check_type TEXT    NOT NULL,
  status     TEXT    NOT NULL CHECK(status IN ('ok','warning','error')),
  latency_ms INTEGER,
  details    TEXT,
  checked_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS backup_runs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  status          TEXT    NOT NULL CHECK(status IN ('running','completed','failed')),
  encrypted       INTEGER NOT NULL DEFAULT 0,
  size_bytes      INTEGER,
  backup_path     TEXT,
  checksum        TEXT,
  started_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  completed_at    TEXT,
  verified_at     TEXT,
  last_error      TEXT
);

CREATE TABLE IF NOT EXISTS update_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  from_version TEXT,
  to_version   TEXT,
  status       TEXT NOT NULL,
  details      TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ops_checks_type ON ops_checks(check_type, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_backup_runs_started ON backup_runs(started_at DESC);
