process.env.PAPERWEIGHT_ALLOW_MISSING_ENV = 'true';
process.env.DASHBOARD_TOKEN = 'test-dashboard-token';
process.env.DOWNLOAD_SIGNING_SECRET = 'test-download-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { freshDb, seedMedia, seedListener, seedToken, futureIso } = require('./helpers');
const { createApp } = require('../src/index');

async function withServer(fn) {
  const app = createApp();
  const server = app.listen(0);
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

test('health and local HLS asset are served', async () => {
  freshDb();
  await withServer(async baseUrl => {
    const health = await request(baseUrl, '/api/health');
    assert.equal(health.res.status, 200);
    assert.equal(health.body.status, 'ok');

    const hls = await request(baseUrl, '/vendor/hls.min.js');
    assert.equal(hls.res.status, 200);
    assert.match(hls.text, /Hls/);
  });
});

test('dashboard auth rejects missing and wrong tokens, accepts the configured token', async () => {
  freshDb();
  await withServer(async baseUrl => {
    assert.equal((await request(baseUrl, '/api/dashboard/vault')).res.status, 401);
    assert.equal((await request(baseUrl, '/api/dashboard/vault', {
      headers: { 'X-Dashboard-Token': 'wrong' },
    })).res.status, 401);

    const ok = await request(baseUrl, '/api/dashboard/vault', {
      headers: { 'X-Dashboard-Token': process.env.DASHBOARD_TOKEN },
    });
    assert.equal(ok.res.status, 200);
    assert.equal(typeof ok.body.totalFiles, 'number');
  });
});

test('token redeem, me, and logout flow works through cookies', async () => {
  const db = freshDb();
  const token = seedToken(db, { tier: 'subscriber' });

  await withServer(async baseUrl => {
    const redeem = await request(baseUrl, '/api/tokens/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token.token }),
    });
    assert.equal(redeem.res.status, 200);
    const cookie = redeem.res.headers.get('set-cookie');
    assert.match(cookie, /pw_token=/);

    const me = await request(baseUrl, '/api/tokens/me', { headers: { cookie } });
    assert.equal(me.res.status, 200);
    assert.equal(me.body.authenticated, true);
    assert.equal(me.body.tier, 'subscriber');

    const logout = await request(baseUrl, '/api/tokens/logout', {
      method: 'POST',
      headers: { cookie },
    });
    assert.equal(logout.res.status, 200);
  });
});

test('listener register, login, me, and password update flow works', async () => {
  freshDb();
  await withServer(async baseUrl => {
    const email = 'listener@example.com';
    const register = await request(baseUrl, '/api/listener/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'password123' }),
    });
    assert.equal(register.res.status, 201);
    const cookie = register.res.headers.get('set-cookie');
    assert.match(cookie, /pw_token=/);

    const me = await request(baseUrl, '/api/listener/me', { headers: { cookie } });
    assert.equal(me.res.status, 200);
    assert.equal(me.body.email, email);

    const pw = await request(baseUrl, '/api/listener/password', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ password: 'newpassword123' }),
    });
    assert.equal(pw.res.status, 200);

    const login = await request(baseUrl, '/api/listener/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'newpassword123' }),
    });
    assert.equal(login.res.status, 200);
  });
});

test('library visibility and gated downloads are enforced', async () => {
  const db = freshDb();
  const publicFile = path.join(os.tmpdir(), `paperweight-http-${Date.now()}.mp3`);
  fs.writeFileSync(publicFile, 'not-real-audio');

  const publicMedia = seedMedia(db, { visibility: 'public', filepath: publicFile });
  const supporterMedia = seedMedia(db, { visibility: 'supporters_only' });
  const listenerId = seedListener(db);
  const token = seedToken(db, { tier: 'subscriber', listenerId });
  db.prepare(
    "INSERT INTO subscriptions (listener_id, tier, provider, provider_subscription_id, status, current_period_end) VALUES (?, 'subscriber', 'stripe', ?, 'active', ?)"
  ).run(listenerId, 'sub_test', futureIso());

  await withServer(async baseUrl => {
    const freeStructure = await request(baseUrl, '/api/library/structure');
    assert.equal(freeStructure.res.status, 200);
    const freeIds = freeStructure.body.standalone.map(item => item.id);
    assert.ok(freeIds.includes(publicMedia.id));
    assert.ok(!freeIds.includes(supporterMedia.id));

    const denied = await request(baseUrl, `/api/library/${publicMedia.id}/download`);
    assert.equal(denied.res.status, 403);

    const allowed = await request(baseUrl, `/api/library/${publicMedia.id}/download`, {
      headers: { Authorization: `Bearer ${token.token}` },
    });
    assert.equal(allowed.res.status, 200);
    assert.match(allowed.body.signedUrl, new RegExp(`/api/library/${publicMedia.id}/file`));
  });

  try { fs.unlinkSync(publicFile); } catch {}
});

test('dashboard upload rejects unsupported multipart file types', async () => {
  freshDb();
  await withServer(async baseUrl => {
    const form = new FormData();
    form.append('media', new Blob(['hello'], { type: 'text/plain' }), 'hello.txt');
    const upload = await fetch(`${baseUrl}/api/dashboard/upload`, {
      method: 'POST',
      headers: { 'X-Dashboard-Token': process.env.DASHBOARD_TOKEN },
      body: form,
    });
    const body = await upload.json();
    assert.equal(upload.status, 400);
    assert.match(body.error, /Unsupported file type/);
  });
});
