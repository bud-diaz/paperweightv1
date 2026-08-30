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
  {
    filename: "015_download_leads.sql",
    sql: `-- Migration 015: Download page email capture
-- Stores emails submitted on the /landing/download page before a download starts.
-- Allows duplicates so each download event is independently recorded.

CREATE TABLE IF NOT EXISTS download_leads (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT    NOT NULL,
  platform   TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_download_leads_email ON download_leads(email);
CREATE INDEX IF NOT EXISTS idx_download_leads_created ON download_leads(created_at);
`,
  },
  {
    filename: "016_highlight.sql",
    sql: `-- Migration 016: Creator-chosen "highlight" for the curated library drawer
-- Single-row table (id = 1). highlight_type/highlight_id NULL means no
-- highlight set; the curated drawer falls back to its next-best candidate.

CREATE TABLE IF NOT EXISTS highlight_config (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  highlight_type TEXT    CHECK (highlight_type IN ('track', 'project')),
  highlight_id   INTEGER,
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO highlight_config (id) VALUES (1);
`,
  },
  {
    filename: "017_share_links.sql",
    sql: `-- Migration 017: Private share links for tracks/projects
-- token is the credential itself: anyone with the URL can view metadata
-- and stream the target without a listener account. expires_at NULL means
-- the link never expires.

CREATE TABLE IF NOT EXISTS share_links (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  token          TEXT    NOT NULL UNIQUE,
  target_type    TEXT    NOT NULL CHECK(target_type IN ('track', 'project')),
  target_id      INTEGER NOT NULL,
  label          TEXT,
  expires_at     TEXT,
  open_count     INTEGER NOT NULL DEFAULT 0,
  last_opened_at TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_share_links_token ON share_links(token);
`,
  },
  {
    filename: "018_smart_playlists.sql",
    sql: `-- Migration 018: Smart playlists
-- A named, saveable category + tags_filter query. schedule_blocks can point
-- at one via target_type = 'smart_playlist' / target_id; the broadcast
-- engine resolves the live track list from the vault at block-start time.

CREATE TABLE IF NOT EXISTS smart_playlists (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  description TEXT,
  category    TEXT,
  tags_filter TEXT,
  mode        TEXT    NOT NULL DEFAULT 'shuffle'
              CHECK(mode IN ('shuffle', 'sequential')),
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
`,
  },
  {
    filename: "019_creator_posts.sql",
    sql: `-- Migration 019: Creator posts
-- Patreon-style text updates, not paywalled items. visibility gates the
-- listener-facing GET /api/posts route by tier; the dashboard sees everything.

CREATE TABLE IF NOT EXISTS creator_posts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT,
  body         TEXT    NOT NULL,
  visibility   TEXT    NOT NULL DEFAULT 'supporters_only'
               CHECK(visibility IN ('public', 'supporters_only')),
  published_at TEXT    NOT NULL DEFAULT (datetime('now')),
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_creator_posts_published ON creator_posts(visibility, published_at);
`,
  },
  {
    filename: "020_download_lead_updates_opt_in.sql",
    sql: `-- Migration 020: Optional download-page updates consent
-- Column added by guarded startup ALTER in src/db/index.js because SQLite
-- does not support ALTER TABLE ADD COLUMN IF NOT EXISTS.
`,
  },
  {
    filename: "021_pending_checkouts.sql",
    sql: `-- Migration 021: Bind browser checkout redirects to local state.
-- Prevents a Stripe session id from acting as a standalone listener login
-- credential by requiring the success redirect to match an unconsumed local
-- checkout nonce created before redirecting to Stripe.

CREATE TABLE IF NOT EXISTS pending_checkouts (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  nonce             TEXT    NOT NULL UNIQUE,
  provider          TEXT    NOT NULL,
  stripe_session_id TEXT    UNIQUE,
  listener_id       INTEGER REFERENCES listener_accounts(id),
  tier              TEXT    NOT NULL,
  expires_at        TEXT    NOT NULL,
  consumed_at       TEXT,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pending_checkouts_nonce ON pending_checkouts(nonce);
CREATE INDEX IF NOT EXISTS idx_pending_checkouts_session ON pending_checkouts(stripe_session_id);
`,
  },
  {
    filename: "022_download_events.sql",
    sql: `-- Migration 022: Download click/event analytics
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
`,
  },
  {
    filename: "023_password_resets.sql",
    sql: `-- Migration 023: Listener password reset tokens
-- Only a SHA-256 hash of the reset token is stored; the raw value lives in the
-- emailed (or creator-copied) link. created_via distinguishes listener-requested
-- email resets from links the creator generated in the dashboard for
-- installs without SMTP configured.

CREATE TABLE IF NOT EXISTS password_resets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  listener_id INTEGER NOT NULL REFERENCES listener_accounts(id) ON DELETE CASCADE,
  token_hash  TEXT    NOT NULL UNIQUE,
  created_via TEXT    NOT NULL DEFAULT 'email' CHECK(created_via IN ('email', 'dashboard')),
  expires_at  TEXT    NOT NULL,
  used_at     TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_password_resets_listener ON password_resets(listener_id);
`,
  },
  {
    filename: "024_app_settings.sql",
    sql: `-- Migration 024: Generic key/value settings store
-- Small creator-configurable flags that don't warrant their own single-row
-- table: notify webhook URL, post email notifications, RSS feed enablement.

CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`,
  },
  {
    filename: "025_genre_offline.sql",
    sql: `-- Migration 025: Track genre + offline save permission
-- Adds media.genre (captured from ffprobe tags, editable in the dashboard,
-- drives public library genre browsing) and media.offline_allowed (creator
-- opt-in per track: listeners with access may save the file locally for
-- browser-based offline playback).
-- Both columns are added by guarded programmatic ALTERs in the migration
-- runner (src/db/index.js) so they can be gated on column existence.
-- SQLite has no IF NOT EXISTS for ALTER TABLE.
`,
  },
  {
    filename: "026_listener_profiles.sql",
    sql: `-- Migration 026: Lightweight listener profiles (welcome-page onboarding)
-- A listener can enter with just a display name; email is optional and only
-- ever used for marketing when marketing_opt_in = 1. Profiles are keyed to the
-- pw_token issued at entry (token_id) and linked to a full listener_accounts
-- row (account_id) if the listener later completes an account to buy or
-- subscribe. listener_accounts is intentionally untouched: its email/password
-- NOT NULL constraints would need a table rebuild, which automatically applied
-- migrations must not do.

CREATE TABLE IF NOT EXISTS listener_profiles (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  display_name     TEXT    NOT NULL,
  email            TEXT,
  marketing_opt_in INTEGER NOT NULL DEFAULT 0,
  account_id       INTEGER REFERENCES listener_accounts(id),
  token_id         INTEGER REFERENCES tokens(id),
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  last_seen_at     TEXT
);

CREATE INDEX IF NOT EXISTS idx_listener_profiles_token   ON listener_profiles(token_id);
CREATE INDEX IF NOT EXISTS idx_listener_profiles_account ON listener_profiles(account_id);
`,
  },
  {
    filename: "027_listener_email_tokens.sql",
    sql: `-- Migration 027: Listener email tokens
-- One table backs two hash-only, single-use link mechanisms: verifying a
-- listener's email address (purpose = 'verify') and the auto-login link sent
-- when a tip includes a donor email (purpose = 'login'). Only a SHA-256 hash
-- of the raw token is stored, matching the password_resets pattern (023) —
-- the raw value lives only in the emailed link fragment.

CREATE TABLE IF NOT EXISTS listener_email_tokens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  listener_id INTEGER NOT NULL REFERENCES listener_accounts(id) ON DELETE CASCADE,
  token_hash  TEXT    NOT NULL UNIQUE,
  purpose     TEXT    NOT NULL CHECK(purpose IN ('verify', 'login')),
  expires_at  TEXT    NOT NULL,
  used_at     TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_listener_email_tokens_listener ON listener_email_tokens(listener_id);
`,
  },
  {
    filename: "028_dashboard_devices.sql",
    sql: `-- Migration 028: Authorized dashboard devices
-- Backs the mobile "Studio" pairing flow: a device paired via QR code gets its
-- own long-lived, individually revocable credential, unlike the raw
-- DASHBOARD_TOKEN + in-memory session used by the primary desktop login.
-- Only a SHA-256 hash of the raw device token is stored, matching the
-- password_resets (023) / listener_email_tokens (027) hash-only pattern.
-- No expires_at — like vault unlocks/share links, these are long-lived until
-- explicitly revoked (revoked_at set), not time-boxed.

CREATE TABLE IF NOT EXISTS dashboard_devices (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  label        TEXT    NOT NULL,
  token_hash   TEXT    NOT NULL UNIQUE,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT,
  revoked_at   TEXT
);
`,
  },
  {
    filename: "029_funnel_events.sql",
    sql: `-- Migration 029: Local activation funnel milestones
-- First-occurrence-only markers for the visit->download->install->first-track->
-- public-station->first-listener funnel (visit/download are already covered by
-- download_leads/download_events, migrations 015/022). Deliberately narrow —
-- four fixed event types, not a general event log — powers a local "setup
-- progress" dashboard widget (GET /api/dashboard/setup-progress) that works
-- whether or not the opt-in telemetry reporter (src/telemetry/reporter.js) is
-- configured, plus that reporter's own aggregate cross-install snapshot when
-- it is. INSERT OR IGNORE at each call site is the entire "recorded already?"
-- check, so there's no read-before-write race.

CREATE TABLE IF NOT EXISTS funnel_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type  TEXT    NOT NULL,
  occurred_at TEXT    NOT NULL DEFAULT (datetime('now')),
  metadata    TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_funnel_events_type ON funnel_events(event_type);
`,
  },
  {
    filename: "030_landing_pageviews.sql",
    sql: `-- Migration 030: Landing page visit tracking
-- Fills the one genuinely-missing funnel stage (visit) — download, install,
-- first-track, went-public, and first-listener are all covered elsewhere
-- (download_leads/download_events, migrations 015/022; funnel_events,
-- migration 029). No cookies, no third-party script: a fire-and-forget beacon
-- from the landing pages themselves (POST /api/landing/pageview).

CREATE TABLE IF NOT EXISTS landing_pageviews (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  path       TEXT    NOT NULL,
  source     TEXT,
  medium     TEXT,
  campaign   TEXT,
  referrer   TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_landing_pageviews_created ON landing_pageviews(created_at);
CREATE INDEX IF NOT EXISTS idx_landing_pageviews_path ON landing_pageviews(path, created_at);
`,
  },
  {
    filename: "031_audience_events.sql",
    sql: `CREATE TABLE IF NOT EXISTS audience_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  profile_id INTEGER REFERENCES listener_profiles(id) ON DELETE SET NULL,
  listener_id INTEGER REFERENCES listener_accounts(id) ON DELETE SET NULL,
  media_id INTEGER REFERENCES media(id) ON DELETE SET NULL,
  project_id INTEGER REFERENCES vault_projects(id) ON DELETE SET NULL,
  post_id INTEGER REFERENCES creator_posts(id) ON DELETE SET NULL,
  source TEXT,
  value_cents INTEGER,
  currency TEXT,
  dedupe_key TEXT UNIQUE,
  metadata TEXT,
  occurred_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audience_events_profile ON audience_events(profile_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audience_events_listener ON audience_events(listener_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audience_events_type ON audience_events(event_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audience_events_media ON audience_events(media_id, occurred_at DESC);`,
  },
  {
    filename: "032_subscription_events.sql",
    sql: `CREATE TABLE IF NOT EXISTS subscription_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription_id INTEGER,
  listener_id INTEGER NOT NULL REFERENCES listener_accounts(id),
  event_type TEXT NOT NULL,
  tier TEXT,
  status TEXT,
  amount_cents INTEGER,
  currency TEXT,
  billing_interval TEXT,
  provider TEXT NOT NULL,
  provider_event_id TEXT,
  provider_subscription_id TEXT,
  dedupe_key TEXT UNIQUE,
  occurred_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_subscription_events_listener ON subscription_events(listener_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_subscription_events_type ON subscription_events(event_type, occurred_at DESC);`,
  },
  {
    filename: "033_jobs_outbox.sql",
    sql: `CREATE TABLE IF NOT EXISTS background_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_type TEXT NOT NULL,
  payload TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','completed','failed','cancelled')),
  run_at TEXT NOT NULL DEFAULT (datetime('now')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  dedupe_key TEXT UNIQUE,
  locked_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_background_jobs_due ON background_jobs(status, run_at);`,
  },
  {
    filename: "034_insight_state.sql",
    sql: `CREATE TABLE IF NOT EXISTS insight_state (
  insight_key TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','dismissed','snoozed','completed')),
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  dismissed_until TEXT,
  metadata TEXT
);`,
  },
  {
    filename: "035_release_campaigns.sql",
    sql: `CREATE TABLE IF NOT EXISTS release_campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  project_id INTEGER REFERENCES vault_projects(id) ON DELETE SET NULL,
  release_at TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'public' CHECK(visibility IN ('public','supporters_only','vault')),
  post_title TEXT,
  post_body TEXT,
  post_visibility TEXT NOT NULL DEFAULT 'public' CHECK(post_visibility IN ('public','supporters_only')),
  notify_webhook INTEGER NOT NULL DEFAULT 1,
  notify_supporters INTEGER NOT NULL DEFAULT 0,
  set_highlight INTEGER NOT NULL DEFAULT 1,
  queue_premiere INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','scheduled','publishing','published','failed','cancelled')),
  published_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS release_campaign_items (
  campaign_id INTEGER NOT NULL REFERENCES release_campaigns(id) ON DELETE CASCADE,
  media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (campaign_id, media_id)
);
CREATE INDEX IF NOT EXISTS idx_release_campaigns_due ON release_campaigns(status, release_at);`,
  },
  {
    filename: "036_automations.sql",
    sql: `CREATE TABLE IF NOT EXISTS automation_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_key TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 0,
  mode TEXT NOT NULL DEFAULT 'draft' CHECK(mode IN ('draft','automatic')),
  config TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS automation_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id INTEGER NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE,
  event_id INTEGER REFERENCES audience_events(id) ON DELETE SET NULL,
  profile_id INTEGER REFERENCES listener_profiles(id) ON DELETE SET NULL,
  listener_id INTEGER REFERENCES listener_accounts(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK(status IN ('recommended','queued','sent','skipped','failed')),
  dedupe_key TEXT NOT NULL UNIQUE,
  explanation TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  executed_at TEXT
);
CREATE TABLE IF NOT EXISTS delivery_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL CHECK(channel IN ('email','webhook')),
  profile_id INTEGER REFERENCES listener_profiles(id) ON DELETE SET NULL,
  listener_id INTEGER REFERENCES listener_accounts(id) ON DELETE SET NULL,
  recipient_email TEXT,
  subject TEXT,
  body TEXT NOT NULL,
  payload TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','failed','cancelled','suppressed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 4,
  run_at TEXT NOT NULL DEFAULT (datetime('now')),
  dedupe_key TEXT UNIQUE,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at TEXT
);
CREATE TABLE IF NOT EXISTS email_suppressions (
  email_hash TEXT PRIMARY KEY,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_automation_runs_status ON automation_runs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_delivery_outbox_due ON delivery_outbox(status, run_at);
INSERT OR IGNORE INTO automation_rules (template_key, enabled, mode) VALUES
  ('welcome_listener',0,'draft'),('first_purchase_thanks',0,'draft'),('release_affinity',0,'draft'),
  ('inactive_regular',0,'draft'),('post_live_followup',0,'draft');`,
  },
  {
    filename: "037_ops_history.sql",
    sql: `CREATE TABLE IF NOT EXISTS ops_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  check_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('ok','warning','error')),
  latency_ms INTEGER,
  details TEXT,
  checked_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS backup_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL CHECK(status IN ('running','completed','failed')),
  encrypted INTEGER NOT NULL DEFAULT 0,
  size_bytes INTEGER,
  backup_path TEXT,
  checksum TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  verified_at TEXT,
  last_error TEXT
);
CREATE TABLE IF NOT EXISTS update_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_version TEXT,
  to_version TEXT,
  status TEXT NOT NULL,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ops_checks_type ON ops_checks(check_type, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_backup_runs_started ON backup_runs(started_at DESC);`,
  },
  {
    filename: "038_participation.sql",
    sql: `CREATE TABLE IF NOT EXISTS listener_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER REFERENCES listener_profiles(id) ON DELETE SET NULL,
  listener_id INTEGER REFERENCES listener_accounts(id) ON DELETE SET NULL,
  media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  dedication TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','played','declined')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS polls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','open','closed')),
  opens_at TEXT,
  closes_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS poll_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS poll_votes (
  poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  option_id INTEGER NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
  profile_id INTEGER REFERENCES listener_profiles(id) ON DELETE CASCADE,
  listener_id INTEGER REFERENCES listener_accounts(id) ON DELETE CASCADE,
  identity_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (poll_id, identity_key)
);
CREATE TABLE IF NOT EXISTS premiere_reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES release_campaigns(id) ON DELETE CASCADE,
  profile_id INTEGER REFERENCES listener_profiles(id) ON DELETE CASCADE,
  listener_id INTEGER REFERENCES listener_accounts(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(campaign_id, email)
);
CREATE INDEX IF NOT EXISTS idx_listener_requests_status ON listener_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_polls_status ON polls(status, opens_at, closes_at);`,
  },
  {
    filename: "039_notify_log.sql",
    sql: `-- Migration 039: Outbound notify webhook log
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
`,
  },
];
