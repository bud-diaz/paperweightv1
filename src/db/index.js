const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const config = require('../config');

const DB_PATH = path.join(config.paths.data, 'paperweight.db');

let db;

function getDb() {
  if (!db) throw new Error('Database not initialized. Call initDb() first.');
  return db;
}

function ensureMigrationTable(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      checksum   TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

function migrationChecksum(sql) {
  return crypto.createHash('sha256').update(sql).digest('hex');
}

function runMigrations(database) {
  ensureMigrationTable(database);

  const migrations = require('./migrations');

  const applied = new Map(
    database.prepare('SELECT filename, checksum FROM schema_migrations').all()
      .map(row => [row.filename, row.checksum])
  );

  for (const { filename, sql } of migrations) {
    const checksum = migrationChecksum(sql);
    const previousChecksum = applied.get(filename);

    if (previousChecksum) {
      if (previousChecksum !== checksum) {
        log('warn', 'db', `Migration ${filename} changed after it was applied; skipping`);
      }
      continue;
    }

    const applyMigration = database.transaction(() => {
      if (sql.trim()) database.exec(sql);
      database.prepare(
        'INSERT INTO schema_migrations (filename, checksum) VALUES (?, ?)'
      ).run(filename, checksum);
    });

    applyMigration();
    log('info', 'db', `Applied migration ${filename}`);
  }

  // Programmatic ALTER TABLE guards — SQLite has no IF NOT EXISTS for ALTER TABLE.
  // Each entry checks for the column before running; safe to run on every startup.
  const alterGuards = [
    {
      table:  'tokens',
      column: 'listener_id',
      sql:    'ALTER TABLE tokens ADD COLUMN listener_id INTEGER REFERENCES listener_accounts(id)',
    },
    {
      table:  'tokens',
      column: 'scope_type',
      sql:    'ALTER TABLE tokens ADD COLUMN scope_type TEXT',
    },
    {
      table:  'tokens',
      column: 'scope_id',
      sql:    'ALTER TABLE tokens ADD COLUMN scope_id INTEGER',
    },
    {
      table:  'tokens',
      column: 'updated_at',
      sql:    'ALTER TABLE tokens ADD COLUMN updated_at TEXT',
    },
    {
      table:  'media',
      column: 'producer',
      sql:    'ALTER TABLE media ADD COLUMN producer TEXT',
    },
    {
      table:  'media',
      column: 'credits',
      sql:    'ALTER TABLE media ADD COLUMN credits TEXT',
    },
    {
      table:  'media',
      column: 'artwork_url',
      sql:    'ALTER TABLE media ADD COLUMN artwork_url TEXT',
    },
    {
      table:  'media',
      column: 'source_platform',
      sql:    'ALTER TABLE media ADD COLUMN source_platform TEXT',
    },
    {
      table:  'media',
      column: 'external_url',
      sql:    'ALTER TABLE media ADD COLUMN external_url TEXT',
    },
    {
      table:  'schedule_blocks',
      column: 'target_type',
      sql:    'ALTER TABLE schedule_blocks ADD COLUMN target_type TEXT',
    },
    {
      table:  'schedule_blocks',
      column: 'target_id',
      sql:    'ALTER TABLE schedule_blocks ADD COLUMN target_id INTEGER',
    },
    {
      table:  'download_leads',
      column: 'updates_opt_in',
      sql:    'ALTER TABLE download_leads ADD COLUMN updates_opt_in INTEGER NOT NULL DEFAULT 0',
    },
    {
      // Store only a SHA-256 hash of each API token, never the plaintext.
      table:  'tokens',
      column: 'token_hash',
      sql:    'ALTER TABLE tokens ADD COLUMN token_hash TEXT',
    },
    {
      // Last accepted TOTP counter — reject replays of an already-used code.
      table:  'dashboard_2fa',
      column: 'last_totp_counter',
      sql:    'ALTER TABLE dashboard_2fa ADD COLUMN last_totp_counter INTEGER',
    },
    {
      // 025 — genre from ffprobe tags; drives public library genre browsing.
      table:  'media',
      column: 'genre',
      sql:    'ALTER TABLE media ADD COLUMN genre TEXT',
    },
    {
      // 025 — creator opt-in: listeners with access may save this file locally
      // for offline browser playback.
      table:  'media',
      column: 'offline_allowed',
      sql:    'ALTER TABLE media ADD COLUMN offline_allowed INTEGER NOT NULL DEFAULT 0',
    },
    {
      // Release scheduler: when set (future), media flips to 'public' at this time.
      table:  'media',
      column: 'release_at',
      sql:    'ALTER TABLE media ADD COLUMN release_at TEXT',
    },
    {
      // Persists the "email supporters" choice so a scheduled post can still
      // honor it when the release scheduler fires notify later.
      table:  'creator_posts',
      column: 'notify_supporters',
      sql:    'ALTER TABLE creator_posts ADD COLUMN notify_supporters INTEGER NOT NULL DEFAULT 0',
    },
    {
      // Marks when notify actually fired for a post, so the release scheduler
      // announces a scheduled post exactly once.
      table:  'creator_posts',
      column: 'release_notified_at',
      sql:    'ALTER TABLE creator_posts ADD COLUMN release_notified_at TEXT',
      // Backfill existing posts as already-notified so an upgrade doesn't make
      // the release scheduler re-announce every historical post on next boot.
      backfill: "UPDATE creator_posts SET release_notified_at = published_at WHERE release_notified_at IS NULL AND published_at IS NOT NULL",
    },
    {
      // Set when a verify/auto-login email link is clicked (or a magic tip
      // login is used). NULL means the listener's email is unverified.
      table:  'listener_accounts',
      column: 'email_verified_at',
      sql:    'ALTER TABLE listener_accounts ADD COLUMN email_verified_at TEXT',
    },
    {
      // Set exactly once, the first time an account becomes paid while still
      // unverified (see activateSubscription in src/api/payment.js). Starts the
      // 24h grace clock; never reset on renewal. NULL = never required, which
      // grandfathers in accounts that were already paid before this shipped.
      table:  'listener_accounts',
      column: 'email_verification_required_at',
      sql:    'ALTER TABLE listener_accounts ADD COLUMN email_verification_required_at TEXT',
    },
    {
      // Set once the one-time Settings spotlight has been dismissed.
      table:  'listener_accounts',
      column: 'settings_tour_seen_at',
      sql:    'ALTER TABLE listener_accounts ADD COLUMN settings_tour_seen_at TEXT',
    },
    {
      // Optional donor identity captured on the tip form. Both null = anonymous.
      table:  'tips',
      column: 'donor_name',
      sql:    'ALTER TABLE tips ADD COLUMN donor_name TEXT',
    },
    {
      table:  'tips',
      column: 'donor_email',
      sql:    'ALTER TABLE tips ADD COLUMN donor_email TEXT',
    },
  ];

  for (const guard of alterGuards) {
    const cols = database.pragma(`table_info(${guard.table})`);
    // Skip guards whose table does not exist yet (created by an earlier migration).
    if (cols.length === 0) continue;
    if (!cols.some(c => c.name === guard.column)) {
      database.exec(guard.sql);
      if (guard.backfill) database.exec(guard.backfill);
    }
  }

  // Token hashing at rest: backfill token_hash from any legacy plaintext token,
  // then overwrite the plaintext `token` column with the hash so the raw value is
  // never persisted. Idempotent — only touches rows still holding a plaintext
  // token (token != token_hash). The `token` column keeps its NOT NULL/UNIQUE
  // shape by storing the hash there too, so lookups can key off either column.
  {
    const tokenCols = database.pragma('table_info(tokens)').map(c => c.name);
    if (tokenCols.includes('token_hash')) {
      const sha256 = value => crypto.createHash('sha256').update(String(value)).digest('hex');
      const pending = database
        .prepare('SELECT id, token, token_hash FROM tokens WHERE token_hash IS NULL OR token_hash <> token')
        .all();
      if (pending.length > 0) {
        const upd = database.prepare('UPDATE tokens SET token = ?, token_hash = ? WHERE id = ?');
        const backfill = database.transaction(rows => {
          for (const row of rows) {
            // If token_hash is already set, `token` is the plaintext to scrub.
            const hash = row.token_hash || sha256(row.token);
            upd.run(hash, hash, row.id);
          }
        });
        backfill(pending);
      }
      database.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_tokens_token_hash ON tokens(token_hash)');
    }
  }

  // Schema rebuild guards — for constraints that can't be changed with ALTER TABLE.
  // Each entry checks sqlite_master for a sentinel string; rebuilds only if missing.

  // 005 — widen subscriptions.tier CHECK to include 'subscriber' (v1.5 supporter tier)
  const subSchema = database.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'subscriptions'"
  ).get();

  if (subSchema && !subSchema.sql.includes("'subscriber'")) {
    database.transaction(() => {
      database.exec(`ALTER TABLE subscriptions RENAME TO subscriptions_old`);
      database.exec(`
        CREATE TABLE subscriptions (
          id                       INTEGER PRIMARY KEY AUTOINCREMENT,
          listener_id              INTEGER NOT NULL REFERENCES listener_accounts(id),
          tier                     TEXT    NOT NULL CHECK(tier IN ('subscriber', 'pro', 'all_access')),
          provider                 TEXT    NOT NULL CHECK(provider IN ('stripe', 'paypal')),
          provider_subscription_id TEXT    NOT NULL,
          status                   TEXT    NOT NULL CHECK(status IN ('active', 'cancelled', 'expired')),
          current_period_end       TEXT    NOT NULL,
          created_at               TEXT    NOT NULL DEFAULT (datetime('now'))
        )
      `);
      database.exec(`INSERT INTO subscriptions SELECT * FROM subscriptions_old`);
      database.exec(`DROP TABLE subscriptions_old`);
    })();
  }

  // 027 — widen subscriptions.provider CHECK to include 'tip' (temporary
  // 7-day supporter access granted by a tip with an email attached).
  const subSchema2 = database.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'subscriptions'"
  ).get();

  if (subSchema2 && !subSchema2.sql.includes("'tip'")) {
    database.transaction(() => {
      database.exec(`ALTER TABLE subscriptions RENAME TO subscriptions_old`);
      database.exec(`
        CREATE TABLE subscriptions (
          id                       INTEGER PRIMARY KEY AUTOINCREMENT,
          listener_id              INTEGER NOT NULL REFERENCES listener_accounts(id),
          tier                     TEXT    NOT NULL CHECK(tier IN ('subscriber', 'pro', 'all_access')),
          provider                 TEXT    NOT NULL CHECK(provider IN ('stripe', 'paypal', 'tip')),
          provider_subscription_id TEXT    NOT NULL,
          status                   TEXT    NOT NULL CHECK(status IN ('active', 'cancelled', 'expired')),
          current_period_end       TEXT    NOT NULL,
          created_at               TEXT    NOT NULL DEFAULT (datetime('now'))
        )
      `);
      database.exec(`INSERT INTO subscriptions SELECT * FROM subscriptions_old`);
      database.exec(`DROP TABLE subscriptions_old`);
    })();
  }
}

function initDb() {
  if (!fs.existsSync(config.paths.data)) {
    fs.mkdirSync(config.paths.data, { recursive: true });
  }

  // pkg/node20 asset globs are broken so better_sqlite3.node is embedded in
  // src/native-bundle.js and extracted to disk at startup by native-loader.js.
  if (typeof process.pkg !== 'undefined') {
    const getNativeBindingPath = require('../native-loader');
    db = new Database(DB_PATH, { nativeBinding: getNativeBindingPath() });
  } else {
    db = new Database(DB_PATH);
  }

  // Performance settings appropriate for single-user self-hosted
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');

  runMigrations(db);

  log('info', 'db', `Database ready at ${DB_PATH}`);
  return db;
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

// Lightweight internal logger that writes to system_log table
// (used only after DB is initialized)
function log(level, component, message) {
  try {
    if (db) {
      db.prepare(
        'INSERT INTO system_log (level, component, message) VALUES (?, ?, ?)'
      ).run(level, component, message);
    }
    const prefix = level === 'error' ? '[ERROR]' : level === 'warn' ? '[WARN]' : '[INFO]';
    console.log(`${prefix} [${component}] ${message}`);
  } catch (err) {
    console.log(`[${level}] [${component}] ${message}`);
    if (!/no such table:\s*system_log/i.test(err.message)) {
      console.error(`[db] Failed to write system_log row: ${err.message}`);
    }
  }
}

module.exports = { initDb, closeDb, getDb, log, runMigrations };
