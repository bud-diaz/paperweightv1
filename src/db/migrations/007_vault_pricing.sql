-- Migration 007: Vault Pricing System
-- Adds vault content tier with per-track, per-project, and all-vault PWYW paywalls.
-- Keep this migration additive. Startup applies migrations automatically, so
-- recurring table rebuilds or DROP TABLE operations are not safe here.

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

-- content_id UNIQUE enforces one-project-per-item at the DB layer.
CREATE TABLE IF NOT EXISTS vault_project_items (
  project_id INTEGER NOT NULL REFERENCES vault_projects(id) ON DELETE CASCADE,
  content_id INTEGER NOT NULL UNIQUE    REFERENCES media(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, content_id)
);

CREATE INDEX IF NOT EXISTS idx_vault_project_items_content ON vault_project_items(content_id);

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

-- Seed disabled default so the row always exists for config reads.
INSERT OR IGNORE INTO vault_all_access (id, enabled, subscribers_included)
VALUES (1, 0, 0);

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
