module.exports = [
  {
    filename: "001_initial.sql",
    sql: `CREATE TABLE IF NOT EXISTS media (
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
  visibility  TEXT    NOT NULL DEFAULT 'public',
  indexed_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  is_active   INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS tokens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  token       TEXT    NOT NULL UNIQUE,
  label       TEXT,
  tier        TEXT    NOT NULL DEFAULT 'subscriber',
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  last_used   TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS schedule_blocks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  day_of_week INTEGER,
  start_time  TEXT    NOT NULL,
  end_time    TEXT    NOT NULL,
  category    TEXT,
  tags_filter TEXT,
  mode        TEXT    NOT NULL DEFAULT 'shuffle',
  label       TEXT,
  priority    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS playlist_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  block_id    INTEGER REFERENCES schedule_blocks(id) ON DELETE CASCADE,
  media_id    INTEGER REFERENCES media(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  UNIQUE(block_id, position)
);

CREATE INDEX IF NOT EXISTS idx_media_category  ON media(category);
CREATE INDEX IF NOT EXISTS idx_media_active    ON media(is_active);
CREATE INDEX IF NOT EXISTS idx_media_visibility ON media(visibility);
CREATE INDEX IF NOT EXISTS idx_tokens_token    ON tokens(token);
CREATE INDEX IF NOT EXISTS idx_schedule_dow    ON schedule_blocks(day_of_week, start_time);
`,
  },
  {
    filename: "002_analytics.sql",
    sql: `CREATE TABLE IF NOT EXISTS listen_events (
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
`,
  },
  {
    filename: "003_monetization.sql",
    sql: `-- Migration 003: Monetization layer for Paperweight v1.5
-- Adds listener accounts, subscriptions, download tokens, saved stations.
-- Also extends the existing tokens table with a listener_id FK.
-- All changes are additive — existing tables and rows are untouched.

-- NOTE: ALTER TABLE tokens ADD COLUMN listener_id is handled in the Node
-- migration runner (src/db/index.js) so it can be gated on column existence.
-- SQLite has no IF NOT EXISTS for ALTER TABLE.

-- Listener accounts (separate from creator accounts)
CREATE TABLE IF NOT EXISTS listener_accounts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  is_active     INTEGER NOT NULL DEFAULT 1
);

-- Active and historical subscriptions per listener
CREATE TABLE IF NOT EXISTS subscriptions (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  listener_id              INTEGER NOT NULL REFERENCES listener_accounts(id),
  tier                     TEXT    NOT NULL CHECK(tier IN ('pro', 'all_access')),
  provider                 TEXT    NOT NULL CHECK(provider IN ('stripe', 'paypal')),
  provider_subscription_id TEXT    NOT NULL,
  status                   TEXT    NOT NULL CHECK(status IN ('active', 'cancelled', 'expired')),
  current_period_end       TEXT    NOT NULL,
  created_at               TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Signed download tokens issued to all_access subscribers (48h expiry)
CREATE TABLE IF NOT EXISTS download_tokens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  media_id    INTEGER NOT NULL REFERENCES media(id),
  listener_id INTEGER NOT NULL REFERENCES listener_accounts(id),
  token       TEXT    NOT NULL UNIQUE,
  expires_at  TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Stations saved by listeners (server-side, synced to account).
-- CLOUD-PHASE GROUNDWORK: the multi-station directory (one Play client, many
-- creator stations keyed by core_url). Unused by the self-hosted build, whose
-- routes are gated behind PAPERWEIGHT_CLOUD. Kept here so the schema is stable
-- ahead of Paperweight Cloud. See ROADMAP.md.
CREATE TABLE IF NOT EXISTS listener_saved_stations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  listener_id INTEGER NOT NULL REFERENCES listener_accounts(id),
  core_url    TEXT    NOT NULL,
  slug        TEXT    NOT NULL,
  name        TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(listener_id, core_url, slug)
);

CREATE INDEX IF NOT EXISTS idx_listener_accounts_email  ON listener_accounts(email);
CREATE INDEX IF NOT EXISTS idx_subscriptions_listener   ON subscriptions(listener_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status     ON subscriptions(listener_id, status);
CREATE INDEX IF NOT EXISTS idx_download_tokens_token    ON download_tokens(token);
CREATE INDEX IF NOT EXISTS idx_download_tokens_listener ON download_tokens(listener_id, media_id);
CREATE INDEX IF NOT EXISTS idx_saved_stations_listener  ON listener_saved_stations(listener_id);
`,
  },
  {
    filename: "004_slug_registry.sql",
    sql: `-- Migration 004: Slug registry for Paperweight
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
`,
  },
  {
    filename: "005_tips.sql",
    sql: `CREATE TABLE IF NOT EXISTS tip_config (
  id             INTEGER PRIMARY KEY CHECK(id = 1),
  amounts        TEXT    NOT NULL DEFAULT '[300,500,1000]',
  custom_enabled INTEGER NOT NULL DEFAULT 1,
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tips (
  id                          INTEGER PRIMARY KEY AUTOINCREMENT,
  amount_cents                INTEGER NOT NULL,
  stripe_payment_intent_id    TEXT,
  stripe_checkout_session_id  TEXT,
  created_at                  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Seed default tip config on first run
INSERT OR IGNORE INTO tip_config (id, amounts, custom_enabled) VALUES (1, '[300,500,1000]', 1);
`,
  },
  {
    filename: "006_webhook_log.sql",
    sql: `-- Webhook event log — one row per received Stripe or PayPal event.
-- outcome: 'ok' | 'skipped' | 'error'
-- error_msg: populated only when outcome = 'error'
CREATE TABLE IF NOT EXISTS webhook_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  provider     TEXT    NOT NULL,             -- 'stripe' | 'paypal'
  event_id     TEXT,                         -- Stripe event.id or PayPal transmissionId
  event_type   TEXT    NOT NULL,
  outcome      TEXT    NOT NULL DEFAULT 'ok',
  error_msg    TEXT,
  received_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_received_at ON webhook_events (received_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_events_event_id    ON webhook_events (event_id);
`,
  },
  {
    filename: "007_vault_pricing.sql",
    sql: `-- Migration 007: Vault Pricing System
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
`,
  },
  {
    filename: "008_private_to_vault.sql",
    sql: `-- Migration 008: Rename 'private' visibility to 'vault'
UPDATE media SET visibility = 'vault' WHERE visibility = 'private';
`,
  },
  {
    filename: "009_token_assignments.sql",
    sql: `-- Migration 009: Token account assignments
-- Allows a single creator-issued token to be assigned to multiple listener accounts.
-- When a listener logs in, their tier is upgraded to the highest-tier assigned token.

CREATE TABLE IF NOT EXISTS token_assignments (
  token_id    INTEGER NOT NULL REFERENCES tokens(id)            ON DELETE CASCADE,
  listener_id INTEGER NOT NULL REFERENCES listener_accounts(id) ON DELETE CASCADE,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (token_id, listener_id)
);

CREATE INDEX IF NOT EXISTS idx_token_assignments_listener ON token_assignments(listener_id);
`,
  },
  {
    filename: "010_webhook_idempotency.sql",
    sql: `-- Prevent duplicate provider webhook deliveries from being processed twice.
CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_events_provider_event_id
ON webhook_events(provider, event_id)
WHERE event_id IS NOT NULL;
`,
  },
  {
    filename: "011_payment_idempotency.sql",
    sql: `-- 011_payment_idempotency.sql
-- Defense-in-depth uniqueness for payment identifiers. The webhook handler now
-- claims each event transactionally (see claimAndRun in src/api/payment.js), but
-- these partial unique indexes also protect the success-redirect paths
-- (/tip-success, /vault checkout return) so a tip or vault unlock can never be
-- recorded twice for the same payment, even outside the webhook gate.
--
-- Partial (WHERE ... IS NOT NULL) so rows without a captured payment id are
-- unaffected. Idempotent and non-destructive per the migration rules in CLAUDE.md.

CREATE UNIQUE INDEX IF NOT EXISTS idx_tips_payment_intent
  ON tips (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_vault_unlocks_payment
  ON vault_unlocks (stripe_payment_id)
  WHERE stripe_payment_id IS NOT NULL;
`,
  },
  {
    filename: "012_dashboard_2fa.sql",
    sql: `-- Migration 012: Dashboard 2FA
-- Single-row table storing the TOTP secret and recovery codes for the creator's
-- dashboard. enabled=0 means 2FA is configured but not active; enabled=1 enforces
-- the second factor on every login attempt.

CREATE TABLE IF NOT EXISTS dashboard_2fa (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  secret         TEXT    NOT NULL,
  enabled        INTEGER NOT NULL DEFAULT 0,
  recovery_codes TEXT    NOT NULL DEFAULT '[]',
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);
`,
  },
  {
    filename: "013_creator_profile.sql",
    sql: `-- Migration 013: Creator bio landing page profile
-- Single-row table (id = 1) for creator public profile data.
-- bio_enabled = 0 means station goes directly to player; = 1 shows the bio landing page.

CREATE TABLE IF NOT EXISTS creator_profile (
  id                INTEGER PRIMARY KEY CHECK (id = 1),
  bio_enabled       INTEGER NOT NULL DEFAULT 0,
  bio               TEXT,
  profile_pic_url   TEXT,
  social_instagram  TEXT,
  social_twitter    TEXT,
  social_youtube    TEXT,
  social_soundcloud TEXT,
  social_spotify    TEXT,
  social_bandcamp   TEXT,
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO creator_profile (id) VALUES (1);
`,
  },
  {
    filename: "014_launch_acceptance.sql",
    sql: `-- Migration 014: First-launch legal acceptance record
-- Single-row table. accepted_at NULL means not yet accepted.

CREATE TABLE IF NOT EXISTS launch_acceptance (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  accepted_at TEXT,
  version     TEXT
);

INSERT OR IGNORE INTO launch_acceptance (id) VALUES (1);
`,
  },
];
