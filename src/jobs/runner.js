'use strict';

const { getDb, log } = require('../db');
const { toSqliteDatetime } = require('../runtime/datetime');

const handlers = new Map();
const POLL_MS = 5_000;
const STALE_LOCK_MINUTES = 10;
let timer = null;
let running = false;

function register(jobType, handler) {
  if (!jobType || typeof handler !== 'function') throw new Error('Job handler requires a type and function');
  handlers.set(jobType, handler);
}

function enqueue(jobType, payload = {}, options = {}) {
  const db = getDb();
  const runAt = toSqliteDatetime(options.runAt || new Date()) || toSqliteDatetime(new Date());
  const info = db.prepare(`
    INSERT OR IGNORE INTO background_jobs (job_type, payload, run_at, max_attempts, dedupe_key)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    jobType,
    JSON.stringify(payload || {}),
    runAt,
    Math.max(1, Math.min(12, Number.parseInt(options.maxAttempts, 10) || 5)),
    options.dedupeKey ? String(options.dedupeKey).slice(0, 200) : null
  );
  if (info.changes) return Number(info.lastInsertRowid);
  if (!options.dedupeKey) return null;
  return db.prepare('SELECT id FROM background_jobs WHERE dedupe_key = ?').get(options.dedupeKey)?.id || null;
}

function reschedule(dedupeKey, runAt, payload) {
  const normalized = toSqliteDatetime(runAt);
  if (!dedupeKey || !normalized) return false;
  const info = getDb().prepare(`
    UPDATE background_jobs
    SET run_at = ?, payload = COALESCE(?, payload), status = 'pending', attempts = 0,
        locked_at = NULL, last_error = NULL, completed_at = NULL, updated_at = datetime('now')
    WHERE dedupe_key = ? AND status != 'running'
  `).run(normalized, payload === undefined ? null : JSON.stringify(payload), String(dedupeKey));
  return info.changes > 0;
}

function cancel(dedupeKey) {
  return getDb().prepare(`
    UPDATE background_jobs SET status = 'cancelled', updated_at = datetime('now')
    WHERE dedupe_key = ? AND status IN ('pending','failed')
  `).run(String(dedupeKey)).changes > 0;
}

function parsePayload(raw) {
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}

function claimNext(db) {
  return db.transaction(() => {
    const job = db.prepare(`
      SELECT * FROM background_jobs
      WHERE status = 'pending' AND run_at <= datetime('now')
      ORDER BY run_at ASC, id ASC
      LIMIT 1
    `).get();
    if (!job) return null;
    const changed = db.prepare(`
      UPDATE background_jobs
      SET status = 'running', locked_at = datetime('now'), attempts = attempts + 1,
          updated_at = datetime('now')
      WHERE id = ? AND status = 'pending'
    `).run(job.id);
    return changed.changes ? { ...job, attempts: job.attempts + 1 } : null;
  })();
}

function retryDelaySeconds(attempt) {
  return Math.min(60 * 60, Math.max(15, 15 * (2 ** Math.max(0, attempt - 1))));
}

async function runOne() {
  const db = getDb();
  const job = claimNext(db);
  if (!job) return false;
  const handler = handlers.get(job.job_type);
  if (!handler) {
    db.prepare(`
      UPDATE background_jobs SET status = 'failed', last_error = ?, updated_at = datetime('now') WHERE id = ?
    `).run(`No handler registered for ${job.job_type}`, job.id);
    return true;
  }

  try {
    await handler(parsePayload(job.payload), job);
    db.prepare(`
      UPDATE background_jobs
      SET status = 'completed', completed_at = datetime('now'), locked_at = NULL,
          last_error = NULL, updated_at = datetime('now')
      WHERE id = ?
    `).run(job.id);
  } catch (err) {
    const exhausted = job.attempts >= job.max_attempts;
    const delay = retryDelaySeconds(job.attempts);
    db.prepare(`
      UPDATE background_jobs
      SET status = ?, run_at = CASE WHEN ? = 1 THEN run_at ELSE datetime('now', ?) END,
          locked_at = NULL, last_error = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(
      exhausted ? 'failed' : 'pending', exhausted ? 1 : 0, `+${delay} seconds`,
      String(err?.message || err).slice(0, 1000), job.id
    );
    log('warn', 'jobs', `${job.job_type} #${job.id} failed: ${err.message}`);
  }
  return true;
}

async function tick() {
  if (running) return;
  running = true;
  try {
    // Bound each tick so a backlog cannot starve the main process.
    for (let count = 0; count < 10; count++) {
      if (!(await runOne())) break;
    }
  } catch (err) {
    try { log('warn', 'jobs', `Runner tick failed: ${err.message}`); } catch {}
  } finally {
    running = false;
  }
}

function recoverStaleJobs() {
  getDb().prepare(`
    UPDATE background_jobs
    SET status = 'pending', locked_at = NULL, updated_at = datetime('now'),
        last_error = COALESCE(last_error || '; ', '') || 'Recovered stale job lock'
    WHERE status = 'running' AND locked_at < datetime('now', ?)
  `).run(`-${STALE_LOCK_MINUTES} minutes`);
}

function start() {
  if (timer) return;
  recoverStaleJobs();
  tick();
  timer = setInterval(tick, POLL_MS);
  timer.unref?.();
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { register, enqueue, reschedule, cancel, runOne, tick, start, stop, recoverStaleJobs };
