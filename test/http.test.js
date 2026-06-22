process.env.PAPERWEIGHT_ALLOW_MISSING_ENV = 'true';
process.env.DASHBOARD_TOKEN = 'test-dashboard-token';
process.env.DOWNLOAD_SIGNING_SECRET = 'test-download-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { freshDb, seedMedia, seedListener, seedToken, futureIso, pastIso } = require('./helpers');
const { createApp } = require('../src/index');
const config = require('../src/config');
const { parseEnvValue, parseTrustProxy } = require('../src/config');
const { resolveAvailableUploadPath, sanitizeUploadName } = require('../src/api/dashboard');
const { ARTWORK_DIR } = require('../src/api/library');

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

test('health and local player assets are served', async () => {
  freshDb();
  await withServer(async baseUrl => {
    const health = await request(baseUrl, '/api/health');
    assert.equal(health.res.status, 200);
    assert.equal(health.body.status, 'ok');
    assert.equal(health.body.version, undefined);

    const hls = await request(baseUrl, '/vendor/hls.min.js');
    assert.equal(hls.res.status, 200);
    assert.match(hls.text, /Hls/);

    const matter = await request(baseUrl, '/vendor/matter.min.js');
    assert.equal(matter.res.status, 200);
    assert.match(matter.text, /Matter/);
  });
});

test('download lead stores normalized email, platform, and updates opt-in', async () => {
  const db = freshDb();
  await withServer(async baseUrl => {
    const result = await request(baseUrl, '/api/download-lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: '  Creator@Example.COM ', platform: ' MAC-ARM64 ', updatesOptIn: true }),
    });

    assert.equal(result.res.status, 200);
    assert.equal(result.body.ok, true);

    const row = db.prepare('SELECT email, platform, updates_opt_in FROM download_leads').get();
    assert.deepEqual(row, {
      email: 'creator@example.com',
      platform: 'mac-arm64',
      updates_opt_in: 1,
    });
  });
});

test('download lead stores updates opt-in as 0 when false or omitted', async () => {
  const db = freshDb();
  await withServer(async baseUrl => {
    const explicitFalse = await request(baseUrl, '/api/download-lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'false@example.com', platform: 'win', updatesOptIn: false }),
    });
    assert.equal(explicitFalse.res.status, 200);

    const omitted = await request(baseUrl, '/api/download-lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'omitted@example.com', platform: 'linux-x64' }),
    });
    assert.equal(omitted.res.status, 200);

    const rows = db.prepare('SELECT email, updates_opt_in FROM download_leads ORDER BY id').all();
    assert.deepEqual(rows, [
      { email: 'false@example.com', updates_opt_in: 0 },
      { email: 'omitted@example.com', updates_opt_in: 0 },
    ]);
  });
});

test('download lead rejects invalid email', async () => {
  freshDb();
  await withServer(async baseUrl => {
    const result = await request(baseUrl, '/api/download-lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email', platform: 'win' }),
    });

    assert.equal(result.res.status, 400);
    assert.match(result.body.error, /Valid email/);
  });
});

test('download lead normalizes unknown platform to null', async () => {
  const db = freshDb();
  await withServer(async baseUrl => {
    const result = await request(baseUrl, '/api/download-lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'platform@example.com', platform: 'amiga' }),
    });

    assert.equal(result.res.status, 200);
    const row = db.prepare('SELECT platform FROM download_leads').get();
    assert.equal(row.platform, null);
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

test('launch acceptance is dashboard-only', async () => {
  const db = freshDb();
  const listenerToken = seedToken(db, { tier: 'subscriber' });

  await withServer(async baseUrl => {
    const publicStatus = await request(baseUrl, '/api/system/launch-status');
    assert.equal(publicStatus.res.status, 401);

    const listenerStatus = await request(baseUrl, '/api/system/launch-status', {
      headers: { Authorization: `Bearer ${listenerToken.token}` },
    });
    assert.equal(listenerStatus.res.status, 401);

    const status = await request(baseUrl, '/api/system/launch-status', {
      headers: { 'X-Dashboard-Token': process.env.DASHBOARD_TOKEN },
    });
    assert.equal(status.res.status, 200);
    assert.equal(status.body.accepted, false);

    const deniedAccept = await request(baseUrl, '/api/system/launch-accept', {
      method: 'POST',
    });
    assert.equal(deniedAccept.res.status, 401);

    const accept = await request(baseUrl, '/api/system/launch-accept', {
      method: 'POST',
      headers: { 'X-Dashboard-Token': process.env.DASHBOARD_TOKEN },
    });
    assert.equal(accept.res.status, 200);
    assert.equal(accept.body.ok, true);

    const row = db.prepare('SELECT accepted_at, version FROM launch_acceptance WHERE id = 1').get();
    assert.ok(row.accepted_at);
    assert.equal(row.version, '1.5.1');
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

    db.prepare('UPDATE tokens SET is_active = 0 WHERE id = ?').run(token.id);
    const revokedFile = await request(baseUrl, allowed.body.signedUrl);
    assert.equal(revokedFile.res.status, 403);
    db.prepare('UPDATE tokens SET is_active = 1 WHERE id = ?').run(token.id);

    const outside = await request(baseUrl, `/api/library/${outsideMedia.id}/download`, {
      headers: { Authorization: `Bearer ${token.token}` },
    });
    assert.equal(outside.res.status, 403);
  });

  try { fs.unlinkSync(publicFile); } catch {}
  try { fs.unlinkSync(outsideFile); } catch {}
});

test('artwork follows media access policy', async () => {
  const db = freshDb();
  fs.mkdirSync(config.vault.path, { recursive: true });
  fs.mkdirSync(ARTWORK_DIR, { recursive: true });
  const supporterFile = path.join(config.vault.path, `supporter-art-${Date.now()}.mp3`);
  fs.writeFileSync(supporterFile, 'not-real-audio');
  const supporterMedia = seedMedia(db, { visibility: 'supporters_only', filepath: supporterFile });
  fs.writeFileSync(path.join(ARTWORK_DIR, `${supporterMedia.id}.jpg`), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

  const listenerId = seedListener(db);
  const token = seedToken(db, { tier: 'subscriber', listenerId });
  db.prepare(
    "INSERT INTO subscriptions (listener_id, tier, provider, provider_subscription_id, status, current_period_end) VALUES (?, 'subscriber', 'stripe', ?, 'active', ?)"
  ).run(listenerId, 'sub_artwork', futureIso());

  await withServer(async baseUrl => {
    const denied = await request(baseUrl, `/api/library/${supporterMedia.id}/artwork`);
    assert.equal(denied.res.status, 403);

    const allowed = await request(baseUrl, `/api/library/${supporterMedia.id}/artwork`, {
      headers: { Authorization: `Bearer ${token.token}` },
    });
    assert.equal(allowed.res.status, 200);
    assert.equal(allowed.res.headers.get('content-type'), 'image/jpeg');
  });

  try { fs.unlinkSync(supporterFile); } catch {}
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

test('private share links resolve without listener auth and track opens', async () => {
  const db = freshDb();
  const media = seedMedia(db, { title: 'Shared Track' });
  const projectId = db.prepare(
    "INSERT INTO vault_projects (name, description) VALUES ('Shared Collection', 'A small set')"
  ).run().lastInsertRowid;
  db.prepare(
    'INSERT INTO vault_project_items (project_id, content_id, sort_order) VALUES (?, ?, 0)'
  ).run(projectId, media.id);

  await withServer(async baseUrl => {
    const created = await request(baseUrl, '/api/dashboard/share', {
      method: 'POST',
      headers: {
        'X-Dashboard-Token': process.env.DASHBOARD_TOKEN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        target_type: 'track',
        target_id: media.id,
        label: 'Press link',
        expires_in_hours: 1,
      }),
    });
    assert.equal(created.res.status, 201);
    assert.equal(created.body.target_type, 'track');
    assert.match(created.body.token, /^[a-f0-9]{48}$/);
    assert.match(created.body.url, /\/share\//);
    assert.ok(created.body.expiresAt);

    const page = await request(baseUrl, `/share/${created.body.token}`);
    assert.equal(page.res.status, 200);
    assert.match(page.text, /public-share-view/);
    assert.match(page.text, /\/js\/main\.js/);

    const firstOpen = await request(baseUrl, `/api/share/${created.body.token}`);
    assert.equal(firstOpen.res.status, 200);
    assert.equal(firstOpen.body.track.id, media.id);
    assert.match(firstOpen.body.track.streamUrl, new RegExp(`/api/library/${media.id}/file`));

    db.prepare("UPDATE share_links SET expires_at = datetime('now', '-1 minute') WHERE token = ?").run(created.body.token);
    const expiredDownload = await request(baseUrl, firstOpen.body.track.streamUrl);
    assert.equal(expiredDownload.res.status, 403);
    db.prepare("UPDATE share_links SET expires_at = datetime('now', '+1 hour') WHERE token = ?").run(created.body.token);

    const secondOpen = await request(baseUrl, `/api/share/${created.body.token}`);
    assert.equal(secondOpen.res.status, 200);

    const row = db.prepare('SELECT open_count, last_opened_at FROM share_links WHERE token = ?').get(created.body.token);
    assert.equal(row.open_count, 2);
    assert.ok(row.last_opened_at);

    const collectionCreated = await request(baseUrl, '/api/dashboard/share', {
      method: 'POST',
      headers: {
        'X-Dashboard-Token': process.env.DASHBOARD_TOKEN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        target_type: 'project',
        target_id: projectId,
      }),
    });
    assert.equal(collectionCreated.res.status, 201);
    assert.equal(collectionCreated.body.target_type, 'project');

    const collectionOpen = await request(baseUrl, `/api/share/${collectionCreated.body.token}`);
    assert.equal(collectionOpen.res.status, 200);
    assert.equal(collectionOpen.body.target_type, 'project');
    assert.equal(collectionOpen.body.collection.name, 'Shared Collection');
    assert.equal(collectionOpen.body.collection.tracks[0].id, media.id);
  });
});

test('creator posts enforce listener tier visibility', async () => {
  const db = freshDb();
  db.prepare("INSERT INTO creator_posts (title, body, visibility) VALUES ('Public', 'hello', 'public')").run();
  db.prepare("INSERT INTO creator_posts (title, body, visibility) VALUES ('Supporters', 'inside', 'supporters_only')").run();
  const listenerId = seedListener(db);
  const token = seedToken(db, { tier: 'subscriber', listenerId });
  db.prepare(
    "INSERT INTO subscriptions (listener_id, tier, provider, provider_subscription_id, status, current_period_end) VALUES (?, 'subscriber', 'stripe', ?, 'active', ?)"
  ).run(listenerId, 'sub_posts', futureIso());

  await withServer(async baseUrl => {
    const free = await request(baseUrl, '/api/posts');
    assert.equal(free.res.status, 200);
    assert.deepEqual(free.body.posts.map(p => p.title), ['Public']);

    const supporter = await request(baseUrl, '/api/posts', {
      headers: { Authorization: `Bearer ${token.token}` },
    });
    assert.equal(supporter.res.status, 200);
    assert.deepEqual(supporter.body.posts.map(p => p.title), ['Supporters', 'Public']);
  });
});

test('smart playlist preview respects tag filters and sequential order', async () => {
  const db = freshDb();
  const later = seedMedia(db, { category: 'music', title: 'Later' });
  const first = seedMedia(db, { category: 'music', title: 'First' });
  const skipped = seedMedia(db, { category: 'music', title: 'Skipped' });
  db.prepare("UPDATE media SET tags = ?, indexed_at = ? WHERE id = ?").run(JSON.stringify(['warm']), '2024-01-02 00:00:00', later.id);
  db.prepare("UPDATE media SET tags = ?, indexed_at = ? WHERE id = ?").run(JSON.stringify(['warm']), '2024-01-01 00:00:00', first.id);
  db.prepare("UPDATE media SET tags = ?, indexed_at = ? WHERE id = ?").run(JSON.stringify(['cold']), '2024-01-03 00:00:00', skipped.id);
  const playlistId = db.prepare(
    "INSERT INTO smart_playlists (name, category, tags_filter, mode) VALUES ('Warm', 'music', ?, 'sequential')"
  ).run(JSON.stringify(['warm'])).lastInsertRowid;

  await withServer(async baseUrl => {
    const preview = await request(baseUrl, `/api/schedule/smart-playlists/${playlistId}/preview`, {
      headers: { 'X-Dashboard-Token': process.env.DASHBOARD_TOKEN },
    });
    assert.equal(preview.res.status, 200);
    assert.deepEqual(preview.body.tracks.map(t => t.id), [first.id, later.id]);
  });
});

test('schedule preview returns exact overlapping timeline with tracks', async () => {
  const db = freshDb();
  const music = seedMedia(db, { category: 'music', title: 'Music A' });
  const beat = seedMedia(db, { category: 'beats', title: 'Beat A' });
  const from = new Date(2024, 0, 3, 9, 30, 0);
  const to = new Date(2024, 0, 3, 11, 30, 0);
  const dow = from.getDay();

  db.prepare(`
    INSERT INTO schedule_blocks (day_of_week, start_time, end_time, category, mode, label, priority)
    VALUES (?, '09:00', '12:00', 'music', 'shuffle', 'Morning', 0)
  `).run(dow);
  db.prepare(`
    INSERT INTO schedule_blocks (day_of_week, start_time, end_time, category, mode, label, priority)
    VALUES (?, '10:00', '11:00', 'beats', 'shuffle', 'Priority', 10)
  `).run(dow);

  await withServer(async baseUrl => {
    const preview = await request(
      baseUrl,
      `/api/schedule/preview?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`,
      { headers: { 'X-Dashboard-Token': process.env.DASHBOARD_TOKEN } }
    );
    assert.equal(preview.res.status, 200);
    assert.deepEqual(preview.body.segments.map(s => s.label), ['Morning', 'Priority', 'Morning']);
    assert.deepEqual(preview.body.segments.map(s => s.blockId), [1, 2, 1]);
    assert.equal(preview.body.segments[0].tracks[0].id, music.id);
    assert.equal(preview.body.segments[1].tracks[0].id, beat.id);
    assert.equal(preview.body.segments[2].tracks[0].id, music.id);
  });
});

test('subscriber analytics returns daily active totals and excludes expired rows', async () => {
  const db = freshDb();
  const activeListener = seedListener(db);
  const expiredListener = seedListener(db);
  const cancelledListener = seedListener(db);
  db.prepare(
    "INSERT INTO subscriptions (listener_id, tier, provider, provider_subscription_id, status, current_period_end, created_at) VALUES (?, 'subscriber', 'stripe', ?, 'active', ?, datetime('now'))"
  ).run(activeListener, 'sub_active_analytics', futureIso());
  db.prepare(
    "INSERT INTO subscriptions (listener_id, tier, provider, provider_subscription_id, status, current_period_end, created_at) VALUES (?, 'subscriber', 'stripe', ?, 'active', ?, datetime('now'))"
  ).run(expiredListener, 'sub_expired_analytics', pastIso());
  db.prepare(
    "INSERT INTO subscriptions (listener_id, tier, provider, provider_subscription_id, status, current_period_end, created_at) VALUES (?, 'subscriber', 'stripe', ?, 'cancelled', ?, datetime('now'))"
  ).run(cancelledListener, 'sub_cancelled_analytics', futureIso());

  await withServer(async baseUrl => {
    const result = await request(baseUrl, '/api/analytics/subscribers?days=1', {
      headers: { 'X-Dashboard-Token': process.env.DASHBOARD_TOKEN },
    });
    assert.equal(result.res.status, 200);
    assert.equal(result.body.activeTotal, 1);
    assert.equal(result.body.rows.length, 1);
    assert.equal(result.body.rows[0].new_subscribers, 3);
    assert.equal(result.body.rows[0].active_total, 1);
  });
});

// ── Phase 7: scheduler + access-token/config routes are desktop-only ──────────
// The shared test harness (helpers.js) sets DEPLOYMENT_PLATFORM=desktop so the
// rest of the suite isn't coupled to platform gating, so these tests flip
// config.platform to 'web' to exercise the 403 side, then restore 'desktop'.
test('schedule block CRUD and preview are desktop-only, list and current stay on web', async () => {
  freshDb();
  const auth = { headers: { 'X-Dashboard-Token': process.env.DASHBOARD_TOKEN } };

  await withServer(async baseUrl => {
    // Desktop (default in this harness): full CRUD + preview works.
    const create = await request(baseUrl, '/api/schedule/blocks', {
      method: 'POST',
      headers: { ...auth.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ start_time: '08:00', end_time: '12:00' }),
    });
    assert.equal(create.res.status, 201);

    const blockId = create.body.id;
    const update = await request(baseUrl, `/api/schedule/blocks/${blockId}`, {
      method: 'PUT',
      headers: { ...auth.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ start_time: '09:00', end_time: '13:00' }),
    });
    assert.equal(update.res.status, 200);

    const items = await request(baseUrl, `/api/schedule/blocks/${blockId}/items`, {
      method: 'PUT',
      headers: { ...auth.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [] }),
    });
    assert.equal(items.res.status, 200);

    const preview = await request(baseUrl, '/api/schedule/preview', auth);
    assert.equal(preview.res.status, 200);

    config.platform = 'web';
    try {
      const list = await request(baseUrl, '/api/schedule/', auth);
      assert.equal(list.res.status, 200);

      const current = await request(baseUrl, '/api/schedule/current');
      assert.equal(current.res.status, 200);

      const webCreate = await request(baseUrl, '/api/schedule/blocks', {
        method: 'POST',
        headers: { ...auth.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ start_time: '14:00', end_time: '16:00' }),
      });
      assert.equal(webCreate.res.status, 403);

      const webUpdate = await request(baseUrl, `/api/schedule/blocks/${blockId}`, {
        method: 'PUT',
        headers: { ...auth.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ start_time: '09:00', end_time: '13:00' }),
      });
      assert.equal(webUpdate.res.status, 403);

      const webItems = await request(baseUrl, `/api/schedule/blocks/${blockId}/items`, {
        method: 'PUT',
        headers: { ...auth.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [] }),
      });
      assert.equal(webItems.res.status, 403);

      const webPreview = await request(baseUrl, '/api/schedule/preview', auth);
      assert.equal(webPreview.res.status, 403);

      const webDel = await request(baseUrl, `/api/schedule/blocks/${blockId}`, { method: 'DELETE', headers: auth.headers });
      assert.equal(webDel.res.status, 403);
    } finally {
      config.platform = 'desktop';
    }

    const del = await request(baseUrl, `/api/schedule/blocks/${blockId}`, { method: 'DELETE', headers: auth.headers });
    assert.equal(del.res.status, 200);
  });
});

test('access-token CRUD, radio-host toggle, and station URL update are desktop-only', async () => {
  freshDb();
  const auth = { headers: { 'X-Dashboard-Token': process.env.DASHBOARD_TOKEN } };
  const jsonAuth = { headers: { ...auth.headers, 'Content-Type': 'application/json' } };

  await withServer(async baseUrl => {
    // Desktop (default in this harness): full token CRUD + radio-host read works.
    const create = await request(baseUrl, '/api/dashboard/tokens', {
      method: 'POST',
      headers: jsonAuth.headers,
      body: JSON.stringify({ label: 'Test', tier: 'subscriber' }),
    });
    assert.equal(create.res.status, 201);

    const tokenId = create.body.id;
    const list = await request(baseUrl, '/api/dashboard/tokens', auth);
    assert.equal(list.res.status, 200);

    const tier = await request(baseUrl, `/api/dashboard/tokens/${tokenId}/tier`, {
      method: 'PATCH',
      headers: jsonAuth.headers,
      body: JSON.stringify({ tier: 'pro' }),
    });
    assert.equal(tier.res.status, 200);

    const radioHost = await request(baseUrl, '/api/dashboard/radio-host', auth);
    assert.equal(radioHost.res.status, 200);

    config.platform = 'web';
    try {
      const webList = await request(baseUrl, '/api/dashboard/tokens', auth);
      assert.equal(webList.res.status, 403);

      const webCreate = await request(baseUrl, '/api/dashboard/tokens', {
        method: 'POST',
        headers: jsonAuth.headers,
        body: JSON.stringify({ label: 'Test2', tier: 'subscriber' }),
      });
      assert.equal(webCreate.res.status, 403);

      const webTier = await request(baseUrl, `/api/dashboard/tokens/${tokenId}/tier`, {
        method: 'PATCH',
        headers: jsonAuth.headers,
        body: JSON.stringify({ tier: 'all_access' }),
      });
      assert.equal(webTier.res.status, 403);

      const webRadioHost = await request(baseUrl, '/api/dashboard/radio-host', auth);
      assert.equal(webRadioHost.res.status, 403);

      const webUrl = await request(baseUrl, '/api/dashboard/station/url', {
        method: 'PUT',
        headers: jsonAuth.headers,
        body: JSON.stringify({ url: 'https://example.com' }),
      });
      assert.equal(webUrl.res.status, 403);

      const webDel = await request(baseUrl, `/api/dashboard/tokens/${tokenId}`, { method: 'DELETE', headers: auth.headers });
      assert.equal(webDel.res.status, 403);
    } finally {
      config.platform = 'desktop';
    }

    const del = await request(baseUrl, `/api/dashboard/tokens/${tokenId}`, { method: 'DELETE', headers: auth.headers });
    assert.equal(del.res.status, 200);
  });
});
