process.env.PAPERWEIGHT_ALLOW_MISSING_ENV = 'true';
process.env.DASHBOARD_TOKEN = 'test-dashboard-token';

const test = require('node:test');
const assert = require('node:assert/strict');

const { freshDb } = require('./helpers');
const { createApp } = require('../src/index');
const { getDb } = require('../src/db');
const notify = require('../src/notify');

async function withServer(fn) {
  const app = createApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(baseUrl);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function request(baseUrl, pathname, options = {}) {
  const res = await fetch(`${baseUrl}${pathname}`, options);
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch {}
  return { res, body, text };
}

function cookieValue(setCookieHeader, name) {
  const match = new RegExp(`${name}=([^;]+)`).exec(setCookieHeader || '');
  return match ? match[1] : null;
}

async function loginAsDesktop(baseUrl) {
  const login = await request(baseUrl, '/api/auth/dashboard/login', {
    method: 'POST',
    headers: { 'X-Dashboard-Token': process.env.DASHBOARD_TOKEN },
  });
  assert.equal(login.res.status, 200);
  return cookieValue(login.res.headers.get('set-cookie'), 'pw_dashboard_session');
}

// Polls until a predicate on the notify_log table passes, or times out. Used
// to observe fireWebhook's setImmediate-deferred write without a fixed sleep.
async function waitFor(predicate, { timeoutMs = 2000, intervalMs = 20 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const rows = getDb().prepare('SELECT * FROM notify_log ORDER BY id ASC').all();
    const result = predicate(rows);
    if (result) return result;
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
}

test('logNotifyEvent writes a row and trims beyond the most recent 200', () => {
  freshDb();

  notify.logNotifyEvent('go-live', 'test content', 'sent', null);
  notify.logNotifyEvent('post', 'another', 'failed', 'boom');

  const rows = getDb().prepare('SELECT * FROM notify_log ORDER BY id ASC').all();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].context, 'go-live');
  assert.equal(rows[0].status, 'sent');
  assert.equal(rows[0].error_msg, null);
  assert.equal(rows[1].context, 'post');
  assert.equal(rows[1].status, 'failed');
  assert.equal(rows[1].error_msg, 'boom');

  for (let i = 0; i < 200; i++) {
    notify.logNotifyEvent('media-release', `filler ${i}`, 'skipped', null);
  }
  const trimmed = getDb().prepare('SELECT COUNT(*) AS n FROM notify_log').get();
  assert.equal(trimmed.n, 200);
});

test('a real fireWebhook call (no webhook configured) lands a skipped row', async () => {
  freshDb();

  notify.liveStarted();

  const rows = await waitFor(rows => (rows.length ? rows : null));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].context, 'go-live');
  assert.equal(rows[0].status, 'skipped');
});

test('GET /api/dashboard/notify-log requires a dashboard session and returns recent-first', async () => {
  freshDb();

  await withServer(async baseUrl => {
    const unauth = await request(baseUrl, '/api/dashboard/notify-log');
    assert.equal(unauth.res.status, 401);

    notify.logNotifyEvent('go-live', 'first', 'sent', null);
    notify.logNotifyEvent('post', 'second', 'failed', 'oops');

    const cookie = await loginAsDesktop(baseUrl);
    const res = await request(baseUrl, '/api/dashboard/notify-log?limit=1', {
      headers: { Cookie: `pw_dashboard_session=${cookie}` },
    });
    assert.equal(res.res.status, 200);
    assert.equal(res.body.events.length, 1);
    assert.equal(res.body.events[0].context, 'post');
    assert.equal(res.body.events[0].status, 'failed');
    assert.equal(res.body.events[0].error_msg, 'oops');
  });
});
