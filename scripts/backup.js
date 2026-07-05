#!/usr/bin/env node
// Hot backup of data/paperweight.db using better-sqlite3's online backup API.
// Safe to run while the server is up (WAL mode). Keeps the newest --keep=N
// backups (default 14) in data/backups/ and prunes the rest.
//
//   npm run backup
//   node scripts/backup.js --keep=30

process.env.PAPERWEIGHT_ALLOW_MISSING_ENV = process.env.PAPERWEIGHT_ALLOW_MISSING_ENV || 'true';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../src/config');

const KEEP = (() => {
  const arg = process.argv.find(a => a.startsWith('--keep='));
  const n = arg ? parseInt(arg.split('=')[1], 10) : 14;
  return Number.isInteger(n) && n > 0 ? n : 14;
})();

async function main() {
  const dbPath = path.join(config.paths.data, 'paperweight.db');
  if (!fs.existsSync(dbPath)) {
    console.error(`Backup failed: database not found at ${dbPath}`);
    process.exit(1);
  }

  const backupDir = path.join(config.paths.data, 'backups');
  fs.mkdirSync(backupDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  const dest = path.join(backupDir, `paperweight-${stamp}.db`);

  const db = new Database(dbPath, { readonly: true });
  try {
    await db.backup(dest);
  } finally {
    db.close();
  }

  const size = fs.statSync(dest).size;
  console.log(`Backup written: ${dest} (${(size / 1024 / 1024).toFixed(1)} MB)`);

  // Prune old scheduled backups (dashboard downloads use a different prefix
  // and clean up after themselves).
  const backups = fs.readdirSync(backupDir)
    .filter(f => /^paperweight-\d{8}-\d{6}\.db$/.test(f))
    .sort()
    .reverse();
  for (const old of backups.slice(KEEP)) {
    fs.unlinkSync(path.join(backupDir, old));
    console.log(`Pruned old backup: ${old}`);
  }
  console.log(`Keeping the newest ${Math.min(KEEP, backups.length)} backup(s) in ${backupDir}`);
}

main().catch(err => {
  console.error(`Backup failed: ${err.message}`);
  process.exit(1);
});
