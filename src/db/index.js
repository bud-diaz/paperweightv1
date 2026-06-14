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
  ];

  for (const guard of alterGuards) {
    const cols = database.pragma(`table_info(${guard.table})`);
    if (!cols.some(c => c.name === guard.column)) {
      database.exec(guard.sql);
    }
  }

  // Schema rebuild guards — for constraints that can't be changed with ALTER TABLE.
  // Each entry checks sqlite_master for a sentinel string; rebuilds only if missing.

  // 005 — widen subscriptions.tier CHECK to include 'subscriber' (v1.5 supporter tier)
  const subSchema = database.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'subscriptions'"
  ).get();

  if (subSchema && !subSchema.sql.includes("'subscriber'")) {
    database.exec(`
      ALTER TABLE subscriptions RENAME TO subscriptions_old;

      CREATE TABLE subscriptions (
        id                       INTEGER PRIMARY KEY AUTOINCREMENT,
        listener_id              INTEGER NOT NULL REFERENCES listener_accounts(id),
        tier                     TEXT    NOT NULL CHECK(tier IN ('subscriber', 'pro', 'all_access')),
        provider                 TEXT    NOT NULL CHECK(provider IN ('stripe', 'paypal')),
        provider_subscription_id TEXT    NOT NULL,
        status                   TEXT    NOT NULL CHECK(status IN ('active', 'cancelled', 'expired')),
        current_period_end       TEXT    NOT NULL,
        created_at               TEXT    NOT NULL DEFAULT (datetime('now'))
      );

      INSERT INTO subscriptions SELECT * FROM subscriptions_old;
      DROP TABLE subscriptions_old;
    `);
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
  } catch {
    console.log(`[${level}] [${component}] ${message}`);
  }
}

module.exports = { initDb, closeDb, getDb, log, runMigrations };
