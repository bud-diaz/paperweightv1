const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const config = require('../config');

const DB_PATH = path.join(config.paths.data, 'paperweight.db');
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

let db;

function getDb() {
  if (!db) throw new Error('Database not initialized. Call initDb() first.');
  return db;
}

function runMigrations(database) {
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    database.exec(sql);
  }
}

function initDb() {
  if (!fs.existsSync(config.paths.data)) {
    fs.mkdirSync(config.paths.data, { recursive: true });
  }

  db = new Database(DB_PATH);

  // Performance settings appropriate for single-user self-hosted
  db.pragma('journal_mode = WAL');
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

module.exports = { initDb, closeDb, getDb, log };
