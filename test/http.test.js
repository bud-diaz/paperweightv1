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
const config = require('../src/config');
const { parseEnvValue, parseTrustProxy } = require('../src/config');
const { resolveAvailableUploadPath, sanitizeUploadName } = require('../src/api/dashboard');

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
    assert.equal(health.body.version, undefined);

    const hls = await request(baseUrl, '/vendor/hls.min.js');
    assert.equal(hls.res.status, 200);
    assert.match(hls.text, /Hls/);
  });
});

test('HLS serves only the stream directory, not runtime work files', async () => {
  freshDb();
  const streamDir = path.join(config.paths.hlsOutput, 'stream');
  fs.mkdirSync(streamDir, { recursive: true });
  fs.writeFileSync(path.join(streamDir, 'index.m3u8'), '#EXTM3U\n', 'utf8');
  fs.writeFileSync(path.join(config.paths.hlsOutput, 'concat.txt'), 'file /secret/song.mp3\n', 'utf8');

  await withServer(async baseUrl => {
    const playlist = await request(baseUrl, '/hls/stream/index.m3u8');
    assert.equal(playlist.res.status, 200);
    assert.match(playlist.text, /#EXTM3U/);

    const concat = await request(baseUrl, '/hls/concat.txt');
    assert.equal(concat.res.status, 404);
  });
});

test('vault unlock options are camelCase for the player UI', async () => {
  const db = freshDb();
  const media = seedMedia(db, { visibility: 'vault' });
  db.prepare(`
    INSERT INTO vault_prices (content_id, suggested_price, minimum_price, allow_free, payment_type, recurring_interval, currency)
    VALUES (?, 700, 300, 1, 'one_time', NULL, 'usd')
  `).run(media.id);

  await withServer(async baseUrl => {
    const result = await request(baseUrl, `/api/vault/unlock-options/${media.id}`);
    assert.equal(result.res.status, 200);
    assert.equal(result.body.isVault, true);
    assert.equal(result.body.unlockOptions.track.minimumPrice, 300);
    assert.equal(result.body.unlockOptions.track.suggestedPrice, 700);
    assert.equal(result.body.unlockOptions.track.allowFree, true);
    assert.equal(result.body.unlockOptions.track.paymentType, 'one_time');
    assert.equal(result.body.unlockOptions.track.minimum_price, undefined);
  });
});

test('supporter previews stay public short previews while vault previews stay blocked', async () => {
  const db = freshDb();
  const supporter = seedMedia(db, { visibility: 'supporters_only' });
  const vault = seedMedia(db, { visibility: 'vault' });

  await withServer(async baseUrl => {
    const vaultPreview = await request(baseUrl, `/api/library/${vault.id}/preview`);
    assert.equal(vaultPreview.res.status, 404);

    const supporterPreview = await request(baseUrl, `/api/library/${supporter.id}/preview`);
    assert.notEqual(supporterPreview.res.status, 403);
    assert.notEqual(supporterPreview.res.status, 404);
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
  fs.mkdirSync(config.vault.path, { recursive: true });
  const publicFile = path.join(config.vault.path, `paperweight-http-${Date.now()}.mp3`);
  const outsideFile = path.join(os.tmpdir(), `paperweight-http-outside-${Date.now()}.mp3`);
  fs.writeFileSync(publicFile, 'not-real-audio');
  fs.writeFileSync(outsideFile, 'not-real-audio');

  const publicMedia = seedMedia(db, { visibility: 'public', filepath: publicFile });
  const outsideMedia = seedMedia(db, { visibility: 'public', filepath: outsideFile });
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

    const outside = await request(baseUrl, `/api/library/${outsideMedia.id}/download`, {
      headers: { Authorization: `Bearer ${token.token}` },
    });
    assert.equal(outside.res.status, 403);
  });

  try { fs.unlinkSync(publicFile); } catch {}
  try { fs.unlinkSync(outsideFile); } catch {}
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

test('upload filenames are sanitized and collision-safe', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-upload-name-'));
  try {
    assert.equal(sanitizeUploadName('../bad name?.mp3'), 'bad_name.mp3');
    fs.writeFileSync(path.join(dir, 'song.mp3'), 'existing');
    const next = resolveAvailableUploadPath(dir, 'song.mp3');
    assert.equal(next.filename, 'song_1.mp3');
    assert.equal(next.filepath, path.join(dir, 'song_1.mp3'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('env parser keeps hash characters inside quoted values', () => {
  assert.equal(parseEnvValue('"abc#123" # comment'), 'abc#123');
  assert.equal(parseEnvValue("'abc#123' # comment"), 'abc#123');
  assert.equal(parseEnvValue('abc#123'), 'abc#123');
  assert.equal(parseEnvValue('abc # comment'), 'abc');
});

test('trust proxy parser supports booleans, hop counts, and named proxy ranges', () => {
  assert.equal(parseTrustProxy('true'), true);
  assert.equal(parseTrustProxy('false'), false);
  assert.equal(parseTrustProxy('1'), true);
  assert.equal(parseTrustProxy('2'), 2);
  assert.equal(parseTrustProxy('loopback'), 'loopback');
});

test('launch-status and launch-accept require dashboard auth', async () => {
  freshDb();
  await withServer(async baseUrl => {
    // Unauthenticated requests must be rejected.
    assert.equal((await request(baseUrl, '/api/system/launch-status')).res.status, 401);
    assert.equal((await request(baseUrl, '/api/system/launch-accept', { method: 'POST' })).res.status, 401);

    // Authenticated via X-Dashboard-Token header.
    const status = await request(baseUrl, '/api/system/launch-status', {
      headers: { 'X-Dashboard-Token': process.env.DASHBOARD_TOKEN },
    });
    assert.equal(status.res.status, 200);
    assert.equal(typeof status.body.accepted, 'boolean');

    const accept = await request(baseUrl, '/api/system/launch-accept', {
      method: 'POST',
      headers: {
        'X-Dashboard-Token': process.env.DASHBOARD_TOKEN,
        'Content-Type': 'application/json',
      },
    });
    assert.equal(accept.res.status, 200);
    assert.equal(accept.body.ok, true);

    // Acceptance should now be recorded.
    const after = await request(baseUrl, '/api/system/launch-status', {
      headers: { 'X-Dashboard-Token': process.env.DASHBOARD_TOKEN },
    });
    assert.equal(after.body.accepted, true);
  });
});
