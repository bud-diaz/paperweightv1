-- Migration 004: Slug registry for Paperweight
-- Stores this station's claimed slug and current public URL.
-- Single row enforced by CHECK (id = 1).
-- At v2, a central registry server will resolve slug → URL across all stations;
-- for now each station carries its own registration locally.

CREATE TABLE IF NOT EXISTS station_registry (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  slug       TEXT NOT NULL,
  url        TEXT NOT NULL,
  claimed_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
