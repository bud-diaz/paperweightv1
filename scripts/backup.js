#!/usr/bin/env node
// Hot backup of data/paperweight.db using better-sqlite3's online backup API.
// Safe to run while the server is up (WAL mode). Keeps the newest --keep=N
// backups (default 14) in data/backups/ and prunes the rest.
//
//   npm run backup
//   node scripts/backup.js --keep=30
//
// Optional encryption at rest (Station Ops' "encrypted backup" deliverable):
// set BACKUP_ENCRYPTION_KEY to a 64-character hex string (32 random bytes —
// e.g. `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)
// and every backup is written as AES-256-GCM ciphertext (`.db.enc`) instead of
// a plain `.db` file. Pure Node `crypto`, no new dependencies, same convention
// as the dashboard 2FA implementation. Restore with:
//
//   node scripts/backup.js --decrypt data/backups/paperweight-<stamp>.db.enc --out restored.db

process.env.PAPERWEIGHT_ALLOW_MISSING_ENV = process.env.PAPERWEIGHT_ALLOW_MISSING_ENV || 'true';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const config = require('../src/config');

const KEEP = (() => {
  const arg = process.argv.find(a => a.startsWith('--keep='));
  const n = arg ? parseInt(arg.split('=')[1], 10) : 14;
  return Number.isInteger(n) && n > 0 ? n : 14;
})();

const ENCRYPTION_KEY_HEX = process.env.BACKUP_ENCRYPTION_KEY;
const GCM_IV_LENGTH = 12;

function encryptionKey() {
  if (!ENCRYPTION_KEY_HEX) return null;
  const key = Buffer.from(ENCRYPTION_KEY_HEX, 'hex');
  if (key.length !== 32) {
    throw new Error('BACKUP_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
  }
  return key;
}

// Layout: [12-byte IV][16-byte GCM auth tag][ciphertext] — auth tag placed
// right after the IV so decryption doesn't need to know the ciphertext length
// up front (it's just "everything after byte 28").
function encryptFile(plainPath, encPath, key) {
  const iv = crypto.randomBytes(GCM_IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = fs.readFileSync(plainPath);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  fs.writeFileSync(encPath, Buffer.concat([iv, authTag, ciphertext]));
}

function decryptFile(encPath, plainPath, key) {
  const data = fs.readFileSync(encPath);
  const iv = data.subarray(0, GCM_IV_LENGTH);
  const authTag = data.subarray(GCM_IV_LENGTH, GCM_IV_LENGTH + 16);
  const ciphertext = data.subarray(GCM_IV_LENGTH + 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  fs.writeFileSync(plainPath, plaintext);
}

async function runDecrypt(args) {
  const inputArg = args.find(a => a.startsWith('--decrypt=')) || args[args.indexOf('--decrypt') + 1];
  const encPath = inputArg?.startsWith('--decrypt=') ? inputArg.slice('--decrypt='.length) : inputArg;
  const outIndex = args.indexOf('--out');
  const outPath = outIndex !== -1 ? args[outIndex + 1] : encPath.replace(/\.enc$/, '');

  const key = encryptionKey();
  if (!key) throw new Error('BACKUP_ENCRYPTION_KEY must be set to decrypt');
  if (!encPath || !fs.existsSync(encPath)) throw new Error(`Encrypted backup not found: ${encPath}`);

  decryptFile(encPath, outPath, key);
  console.log(`Decrypted: ${outPath}`);
}

async function main() {
  if (process.argv.includes('--decrypt')) {
    return runDecrypt(process.argv.slice(2));
  }

  const dbPath = path.join(config.paths.data, 'paperweight.db');
  if (!fs.existsSync(dbPath)) {
    console.error(`Backup failed: database not found at ${dbPath}`);
    process.exit(1);
  }

  const backupDir = path.join(config.paths.data, 'backups');
  fs.mkdirSync(backupDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  const plainDest = path.join(backupDir, `paperweight-${stamp}.db`);

  const db = new Database(dbPath, { readonly: true });
  try {
    await db.backup(plainDest);
  } finally {
    db.close();
  }

  const key = encryptionKey();
  let finalDest = plainDest;
  if (key) {
    finalDest = `${plainDest}.enc`;
    encryptFile(plainDest, finalDest, key);
    fs.unlinkSync(plainDest); // never leave the plaintext copy at rest
  }

  const size = fs.statSync(finalDest).size;
  const label = key ? ' (encrypted)' : '';
  console.log(`Backup written: ${finalDest}${label} (${(size / 1024 / 1024).toFixed(1)} MB)`);

  // Prune old scheduled backups (dashboard downloads use a different prefix
  // and clean up after themselves). Matches both plain and .enc extensions so
  // switching BACKUP_ENCRYPTION_KEY on/off doesn't leave the old format
  // accumulating forever.
  const backups = fs.readdirSync(backupDir)
    .filter(f => /^paperweight-\d{8}-\d{6}\.db(\.enc)?$/.test(f))
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
