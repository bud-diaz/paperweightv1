#!/usr/bin/env node
// Verifies migrations can run repeatedly on a fresh throwaway database.

process.env.PAPERWEIGHT_ALLOW_MISSING_ENV = 'true';

const fs = require('fs');
const os = require('os');
const path = require('path');

let Database;
try {
  Database = require('better-sqlite3');
} catch (err) {
  console.error(`Migration check failed: better-sqlite3 is not installed (${err.message})`);
  console.error('Run npm install first.');
  process.exit(1);
}

const { runMigrations } = require('../src/db');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paperweight-migrations-'));
const dbPath = path.join(tempDir, 'paperweight-test.db');
const db = new Database(dbPath);

try {
  db.pragma('foreign_keys = ON');

  runMigrations(db);
  const firstCount = db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n;

  runMigrations(db);
  const secondCount = db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n;

  if (firstCount !== secondCount) {
    throw new Error(`Migration count changed on second run (${firstCount} -> ${secondCount})`);
  }

  const mediaNew = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'media_new'"
  ).get();
  if (mediaNew) {
    throw new Error('Unsafe leftover table media_new exists after migrations');
  }

  const tokenColumns = db.pragma('table_info(tokens)').map(col => col.name);
  for (const required of ['listener_id', 'scope_type', 'scope_id', 'updated_at']) {
    if (!tokenColumns.includes(required)) {
      throw new Error(`tokens.${required} was not created`);
    }
  }

  const twoFaTable = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'dashboard_2fa'"
  ).get();
  if (!twoFaTable) {
    throw new Error('dashboard_2fa table was not created');
  }

  const twoFaColumns = db.pragma('table_info(dashboard_2fa)').map(col => col.name);
  for (const required of ['secret', 'enabled', 'recovery_codes', 'created_at']) {
    if (!twoFaColumns.includes(required)) {
      throw new Error(`dashboard_2fa.${required} was not created`);
    }
  }

  // Migrations 013–015: tables consumed by live API routes.
  for (const table of ['creator_profile', 'launch_acceptance', 'download_leads']) {
    const row = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?"
    ).get(table);
    if (!row) {
      throw new Error(`${table} table was not created (migration 013–015 missing or broken)`);
    }
  }

  console.log(`Migration check passed (${secondCount} migrations applied once).`);
} catch (err) {
  console.error(`Migration check failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}
