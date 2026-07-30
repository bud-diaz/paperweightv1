'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const config = require('../config');
const { getDb, log } = require('../db');
const { getFFmpegStatus } = require('../runtime/ffmpeg');
const tunnel = require('../runtime/tunnel-supervisor');
const broadcast = require('../broadcast');
const jobs = require('../jobs/runner');
const { getBoolSetting, setSetting } = require('../db/settings');

const BACKUP_KEEP = 14;
const CHECK_INTERVAL_MS = 15 * 60 * 1000;
const IV_BYTES = 12;

function backupDirectory() {
  const dir = path.join(config.paths.data, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function encryptionKey() {
  const raw = process.env.BACKUP_ENCRYPTION_KEY;
  if (!raw) return null;
  const key = Buffer.from(raw, 'hex');
  if (key.length !== 32) throw new Error('BACKUP_ENCRYPTION_KEY must contain 32 bytes as 64 hex characters');
  return key;
}

function encryptFile(plainPath, destination, key) {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = fs.readFileSync(plainPath);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  fs.writeFileSync(destination, Buffer.concat([iv, cipher.getAuthTag(), ciphertext]));
}

function decryptFile(source, destination, key) {
  const data = fs.readFileSync(source);
  const iv = data.subarray(0, IV_BYTES);
  const tag = data.subarray(IV_BYTES, IV_BYTES + 16);
  const ciphertext = data.subarray(IV_BYTES + 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  fs.writeFileSync(destination, Buffer.concat([decipher.update(ciphertext), decipher.final()]));
}

function checksum(filepath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filepath)).digest('hex');
}

function safeBackupPath(filename) {
  if (!/^paperweight-ops-\d{8}-\d{6}\.db(?:\.enc)?$/.test(filename)) return null;
  const base = path.resolve(backupDirectory());
  const candidate = path.resolve(base, filename);
  return candidate.startsWith(`${base}${path.sep}`) ? candidate : null;
}

function pruneBackups() {
  const dir = backupDirectory();
  const files = fs.readdirSync(dir).filter(name => /^paperweight-ops-\d{8}-\d{6}\.db(?:\.enc)?$/.test(name)).sort().reverse();
  for (const name of files.slice(BACKUP_KEEP)) fs.unlinkSync(path.join(dir, name));
}

async function createBackup() {
  const db = getDb();
  const info = db.prepare("INSERT INTO backup_runs (status, encrypted) VALUES ('running', ?)").run(encryptionKey() ? 1 : 0);
  const runId = Number(info.lastInsertRowid);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  const plain = path.join(backupDirectory(), `paperweight-ops-${stamp}.db`);
  let finalPath = plain;
  try {
    await db.backup(plain);
    const key = encryptionKey();
    if (key) {
      finalPath = `${plain}.enc`;
      encryptFile(plain, finalPath, key);
      fs.unlinkSync(plain);
    }
    const stats = fs.statSync(finalPath);
    const hash = checksum(finalPath);
    db.prepare(`
      UPDATE backup_runs SET status='completed', size_bytes=?, backup_path=?, checksum=?, completed_at=datetime('now') WHERE id=?
    `).run(stats.size, path.basename(finalPath), hash, runId);
    await verifyBackup(runId);
    pruneBackups();
    log('info', 'ops', `Verified backup created: ${path.basename(finalPath)}`);
    return status().latestBackup;
  } catch (err) {
    try { if (fs.existsSync(plain)) fs.unlinkSync(plain); } catch {}
    db.prepare("UPDATE backup_runs SET status='failed', completed_at=datetime('now'), last_error=? WHERE id=?")
      .run(String(err.message).slice(0, 1000), runId);
    throw err;
  }
}

async function verifyBackup(runId) {
  const db = getDb();
  const run = db.prepare("SELECT * FROM backup_runs WHERE id=? AND status='completed'").get(runId);
  if (!run) throw new Error('Completed backup not found');
  const source = safeBackupPath(run.backup_path);
  if (!source || !fs.existsSync(source)) throw new Error('Backup file is missing');
  if (checksum(source) !== run.checksum) throw new Error('Backup checksum does not match');
  let verifyPath = source;
  let temporary = null;
  try {
    if (run.encrypted) {
      temporary = path.join(backupDirectory(), `.verify-${run.id}-${crypto.randomBytes(6).toString('hex')}.db`);
      decryptFile(source, temporary, encryptionKey());
      verifyPath = temporary;
    }
    const checkDb = new Database(verifyPath, { readonly: true, fileMustExist: true });
    try {
      const result = checkDb.pragma('integrity_check', { simple: true });
      if (result !== 'ok') throw new Error(`SQLite integrity check failed: ${result}`);
      checkDb.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get();
    } finally { checkDb.close(); }
    db.prepare("UPDATE backup_runs SET verified_at=datetime('now'), last_error=NULL WHERE id=?").run(runId);
    return true;
  } catch (err) {
    db.prepare('UPDATE backup_runs SET last_error=? WHERE id=?').run(String(err.message).slice(0,1000), runId);
    throw err;
  } finally {
    if (temporary && fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function runChecks() {
  const db = getDb();
  const checks = [];
  const add = (type, checkStatus, details, latency = null) => {
    db.prepare('INSERT INTO ops_checks (check_type,status,latency_ms,details) VALUES (?,?,?,?)')
      .run(type, checkStatus, latency, JSON.stringify(details || {}));
    checks.push({ type, status: checkStatus, details });
  };
  const ffmpeg = getFFmpegStatus();
  add('ffmpeg', ffmpeg.ok ? 'ok' : 'error', ffmpeg);
  const state = broadcast.getState();
  add('broadcast', state.isRunning ? 'ok' : 'error', { running: state.isRunning, mode: state.mode, nowPlaying: state.nowPlaying?.title || null });
  const tunnelStatus = tunnel.getStatus();
  const tunnelEnabled = !!config.station.cloudflareTunnel;
  add('tunnel', !tunnelEnabled || tunnelStatus.status === 'connected' ? 'ok' : (tunnelStatus.status === 'connecting' ? 'warning' : 'error'), tunnelStatus);
  const webhookErrors = db.prepare("SELECT COUNT(*) AS n FROM webhook_events WHERE outcome='error' AND received_at >= datetime('now','-24 hours')").get().n;
  add('payments', webhookErrors ? 'error' : 'ok', { webhookErrors24h: webhookErrors });
  const latest = db.prepare("SELECT * FROM backup_runs WHERE status='completed' ORDER BY started_at DESC LIMIT 1").get();
  const old = !latest || Date.now() - new Date(String(latest.started_at).replace(' ', 'T') + 'Z').getTime() > 48 * 3600000;
  add('backup', old ? 'warning' : (latest.verified_at ? 'ok' : 'warning'), { latestAt: latest?.completed_at || null, verifiedAt: latest?.verified_at || null });
  if (getBoolSetting('ops_auto_backup', false) && old) {
    const day = new Date().toISOString().slice(0, 10);
    jobs.enqueue('ops.backup', {}, { dedupeKey: `ops-backup:${day}`, maxAttempts: 3 });
  }
  db.prepare("DELETE FROM ops_checks WHERE checked_at < datetime('now','-90 days')").run();
  return checks;
}

function status() {
  const db = getDb();
  const latestChecks = db.prepare(`
    SELECT oc.* FROM ops_checks oc JOIN (
      SELECT check_type, MAX(id) AS id FROM ops_checks GROUP BY check_type
    ) latest ON latest.id=oc.id ORDER BY oc.check_type
  `).all().map(row => ({ ...row, details: (() => { try { return JSON.parse(row.details || '{}'); } catch { return {}; } })() }));
  const latestBackup = db.prepare('SELECT * FROM backup_runs ORDER BY started_at DESC LIMIT 1').get() || null;
  const uptime = db.prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN status='ok' THEN 1 ELSE 0 END) AS ok FROM ops_checks WHERE check_type='broadcast' AND checked_at >= datetime('now','-30 days')`).get();
  return {
    checks: latestChecks,
    latestBackup,
    broadcastAvailabilityPct: uptime.total ? Math.round((uptime.ok / uptime.total) * 10000) / 100 : null,
    autoBackup: getBoolSetting('ops_auto_backup', false),
    externalMonitoringRequired: true,
  };
}

function scheduleNextCheck() {
  const next = new Date(Date.now() + CHECK_INTERVAL_MS);
  const bucket = next.toISOString().slice(0, 16);
  jobs.enqueue('ops.check', {}, { runAt: next, dedupeKey: `ops-check:${bucket}`, maxAttempts: 2 });
}

jobs.register('ops.check', () => { runChecks(); scheduleNextCheck(); });
jobs.register('ops.backup', async () => { await createBackup(); });

function ensureSchedules() {
  jobs.enqueue('ops.check', {}, { dedupeKey: `ops-check:${new Date().toISOString().slice(0,16)}`, maxAttempts: 2 });
}

module.exports = { createBackup, verifyBackup, runChecks, status, ensureSchedules, safeBackupPath };
