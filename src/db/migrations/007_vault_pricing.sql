-- Migration 007: Vault Pricing System
-- Adds vault content tier with per-track, per-project, and all-vault PWYW paywalls.
-- All changes are additive except the media table rebuild (adds 'vault' to visibility CHECK).

-- ─── Rebuild media to add 'vault' visibility value ────────────────────────────
-- SQLite cannot ALTER a CHECK constraint; rebuild is required.
-- All existing rows are preserved. None currently have visibility='vault'.

CREATE TABLE IF NOT EXISTS media_new (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  filepath    TEXT    NOT NULL UNIQUE,
  filename    TEXT    NOT NULL,
  category    TEXT    NOT NULL,
  title       TEXT,
  artist      TEXT,
  album       TEXT,
  duration    REAL,
  bpm         REAL,
  tags        TEXT,
  file_size   INTEGER,
  mime_type   TEXT,
  visibility  TEXT    NOT NULL DEFAULT 'public'
              CHECK(visibility IN ('public','supporters_only','private','vault')),
  indexed_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  is_active   INTEGER NOT NULL DEFAULT 1
);

INSERT INTO media_new SELECT * FROM media;

DROP TABLE media;

ALTER TABLE media_new RENAME TO media;

-- Recreate indexes dropped with the old table
CREATE INDEX IF NOT EXISTS idx_media_category   ON media(category);
CREATE INDEX IF NOT EXISTS idx_media_active     ON media(is_active);
CREATE INDEX IF NOT EXISTS idx_media_visibility ON media(visibility);

-- ─── vault_prices — per-track pricing config ──────────────────────────────────

CREATE TABLE IF NOT EXISTS vault_prices (
  content_id         INTEGER PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE,
  suggested_price    INTEGER NOT NULL DEFAULT 0,
  minimum_price      INTEGER NOT NULL DEFAULT 0,
  allow_free         INTEGER NOT NULL DEFAULT 0,
  payment_type       TEXT    NOT NULL DEFAULT 'one_time'
                     CHECK(payment_type IN ('one_time','recurring')),
  recurring_interval TEXT    CHECK(recurring_interval IN ('monthly','annually')),
  currency           TEXT    NOT NULL DEFAULT 'usd',
  created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ─── vault_projects — named collections ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS vault_projects (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  name               TEXT    NOT NULL,
  description        TEXT,
  cover_art_path     TEXT,
  suggested_price    INTEGER NOT NULL DEFAULT 0,
  minimum_price      INTEGER NOT NULL DEFAULT 0,
  allow_free         INTEGER NOT NULL DEFAULT 0,
  payment_type       TEXT    NOT NULL DEFAULT 'one_time'
                     CHECK(payment_type IN ('one_time','recurring')),
  recurring_interval TEXT    CHECK(recurring_interval IN ('monthly','annually')),
  currency           TEXT    NOT NULL DEFAULT 'usd',
  created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ─── vault_project_items — project membership ─────────────────────────────────
-- content_id UNIQUE enforces one-project-per-item at the DB layer.

CREATE TABLE IF NOT EXISTS vault_project_items (
  project_id INTEGER NOT NULL REFERENCES vault_projects(id) ON DELETE CASCADE,
  content_id INTEGER NOT NULL UNIQUE    REFERENCES media(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, content_id)
);

CREATE INDEX IF NOT EXISTS idx_vault_project_items_content ON vault_project_items(content_id);

-- ─── vault_all_access — singleton all-vault pass config ───────────────────────

CREATE TABLE IF NOT EXISTS vault_all_access (
  id                   INTEGER PRIMARY KEY CHECK(id = 1),
  enabled              INTEGER NOT NULL DEFAULT 0,
  subscribers_included INTEGER NOT NULL DEFAULT 0,
  suggested_price      INTEGER NOT NULL DEFAULT 0,
  minimum_price        INTEGER NOT NULL DEFAULT 0,
  allow_free           INTEGER NOT NULL DEFAULT 0,
  payment_type         TEXT    NOT NULL DEFAULT 'recurring'
                       CHECK(payment_type IN ('one_time','recurring')),
  recurring_interval   TEXT    CHECK(recurring_interval IN ('monthly','annually')),
  currency             TEXT    NOT NULL DEFAULT 'usd',
  updated_at           TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Seed disabled default so the row always exists for config reads
INSERT OR IGNORE INTO vault_all_access (id, enabled, subscribers_included)
VALUES (1, 0, 0);

-- ─── vault_unlocks — listener purchase records ───────────────────────────────

CREATE TABLE IF NOT EXISTS vault_unlocks (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  listener_id       INTEGER NOT NULL REFERENCES listener_accounts(id),
  unlock_type       TEXT    NOT NULL
                    CHECK(unlock_type IN ('track','project','all_access')),
  target_id         INTEGER,
  amount_paid       INTEGER NOT NULL DEFAULT 0,
  payment_type      TEXT    NOT NULL
                    CHECK(payment_type IN ('one_time','recurring')),
  stripe_payment_id TEXT,
  active            INTEGER NOT NULL DEFAULT 1,
  expires_at        TEXT,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_vault_unlocks_listener ON vault_unlocks(listener_id);
CREATE INDEX IF NOT EXISTS idx_vault_unlocks_active   ON vault_unlocks(listener_id, active, unlock_type);
