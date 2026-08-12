-- Migration 033: durable, retryable background work for releases, messaging,
-- insights, and maintenance. A single-process runner claims jobs atomically.

CREATE TABLE IF NOT EXISTS background_jobs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  job_type     TEXT    NOT NULL,
  payload      TEXT,
  status       TEXT    NOT NULL DEFAULT 'pending'
               CHECK(status IN ('pending','running','completed','failed','cancelled')),
  run_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  attempts     INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  dedupe_key   TEXT    UNIQUE,
  locked_at    TEXT,
  last_error   TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_background_jobs_due ON background_jobs(status, run_at);
