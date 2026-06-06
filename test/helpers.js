// Shared test harness.
//
// Builds a fully-migrated throwaway SQLite database and exposes seed helpers.
// `node --test` runs each test file in its own process, so each file gets an
// isolated database and there is no cross-file state.
//
// IMPORTANT: these two env vars must be set before ../src/config is required,
// which is why this module sets them at load time and every test file requires
// it first.
process.env.PAPERWEIGHT_ALLOW_MISSING_ENV = 'true';

const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Point the app's data dir at a fresh temp dir BEFORE requiring config/db so
// initDb() opens a throwaway database instead of the real one.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-test-'));
process.env.DATA_PATH = tmpDir;

const { initDb, closeDb, getDb } = require('../src/db');

const dbFile = path.join(tmpDir, 'paperweight.db');

// Returns a clean, fully-migrated database. Call at the start of each test to
// guarantee isolation from the previous one.
function freshDb() {
  closeDb();
  for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) {
    try { fs.rmSync(f, { force: true }); } catch {}
  }
  return initDb();
}

function seedMedia(db, { visibility = 'public', category = 'music', title = 'Track' } = {}) {
  const info = db.prepare(
    'INSERT INTO media (filepath, filename, category, title, visibility) VALUES (?, ?, ?, ?, ?)'
  ).run(`/vault/${crypto.randomUUID()}.mp3`, 'f.mp3', category, title, visibility);
  return db.prepare('SELECT * FROM media WHERE id = ?').get(info.lastInsertRowid);
}

function seedListener(db, email) {
  const addr = email || `u${crypto.randomUUID()}@example.com`;
  const info = db.prepare(
    'INSERT INTO listener_accounts (email, password_hash) VALUES (?, ?)'
  ).run(addr, 'x');
  return info.lastInsertRowid;
}

function seedToken(db, { tier = 'free', listenerId = null, scopeType = null, scopeId = null } = {}) {
  const token = crypto.randomBytes(16).toString('hex');
  const info = db.prepare(
    'INSERT INTO tokens (token, label, tier, listener_id, scope_type, scope_id) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(token, null, tier, listenerId, scopeType, scopeId);
  return db.prepare('SELECT * FROM tokens WHERE id = ?').get(info.lastInsertRowid);
}

function futureIso(ms = 24 * 60 * 60 * 1000) {
  return new Date(Date.now() + ms).toISOString();
}

function pastIso(ms = 24 * 60 * 60 * 1000) {
  return new Date(Date.now() - ms).toISOString();
}

// Builds the real API router on a throwaway Express server listening on an
// ephemeral port, mirroring src/index.js's middleware stack (json, cookies,
// CSRF) without the broadcast/scanner subsystems. Returns { base, close }.
// NOTE: any test that exercises dashboard auth must set process.env.DASHBOARD_TOKEN
// BEFORE requiring this module, because src/config reads it once at load time.
function createTestServer() {
  const express = require('express');
  const cookieParser = require('cookie-parser');
  const { csrfCheck } = require('../src/middleware/csrfCheck');
  const apiRouter = require('../src/api/router');

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(csrfCheck);
  app.use('/api', apiRouter);

  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        base: `http://127.0.0.1:${port}`,
        close: () => new Promise(done => server.close(done)),
      });
    });
  });
}

// Best-effort cleanup of the temp dir when the test process exits.
process.on('exit', () => {
  try { closeDb(); } catch {}
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

module.exports = {
  freshDb,
  getDb,
  seedMedia,
  seedListener,
  seedToken,
  futureIso,
  pastIso,
  createTestServer,
};
