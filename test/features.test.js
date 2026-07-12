process.env.PAPERWEIGHT_ALLOW_MISSING_ENV = 'true';
process.env.DASHBOARD_TOKEN = 'test-dashboard-token';
process.env.DOWNLOAD_SIGNING_SECRET = 'test-download-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const bcrypt = require('bcryptjs');

const { freshDb, seedMedia, seedListener } = require('./helpers');
const { createApp } = require('../src/index');
const { authLimiter } = require('../src/middleware/rateLimiter');

// The auth rate limiter is a process-wide singleton (10 req / 15 min); the
// tests in this file legitimately exceed that, so clear it between tests.
function resetAuthLimiter() {
  for (const key of ['127.0.0.1', '::ffff:127.0.0.1', '::1']) {
    try { authLimiter.resetKey(key); } catch {}
  }
}

const DASH = { 'X-Dashboard-Token': 'test-dashboard-token', 'Content-Type': 'application/json' };
const JSON_HDR = { 'Content-Type': 'application/json' };

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

function seedAccount(db, email, password) {
  const info = db.prepare(
    'INSERT INTO listener_accounts (email, password_hash) VALUES (?, ?)'
  ).run(email, bcrypt.hashSync(password, 4));
  return info.lastInsertRowid;
}

test('scanner imports new media as vault but preserves pre-stamped visibility', () => {
  const db = freshDb();
  const config = require('../src/config');
  const { upsert } = require('../src/scanner/sync');
  fs.mkdirSync(config.vault.path, { recursive: true });

  const freshPath = path.join(config.vault.path, `scanner-fresh-${Date.now()}.mp3`);
  const stampedPath = path.join(config.vault.path, `scanner-stamped-${Date.now()}.mp3`);
  fs.writeFileSync(freshPath, 'fresh');
  fs.writeFileSync(stampedPath, 'stamped');

  try {
    upsert(freshPath, 'music', { title: 'Fresh Scan', duration: 12, file_size: 5, mime_type: 'audio/mpeg' });
    assert.equal(db.prepare('SELECT visibility FROM media WHERE filepath = ?').get(path.resolve(freshPath)).visibility, 'vault');

    db.prepare(
      "INSERT INTO media (filepath, filename, category, title, visibility) VALUES (?, ?, 'music', 'Stamped', 'public')"
    ).run(path.resolve(stampedPath), path.basename(stampedPath));
    upsert(stampedPath, 'music', { title: 'Updated Stamp', duration: 18, file_size: 7, mime_type: 'audio/mpeg' });

    const stamped = db.prepare('SELECT title, visibility FROM media WHERE filepath = ?').get(path.resolve(stampedPath));
    assert.equal(stamped.title, 'Updated Stamp');
    assert.equal(stamped.visibility, 'public');
  } finally {
    try { fs.unlinkSync(freshPath); } catch {}
    try { fs.unlinkSync(stampedPath); } catch {}
  }
});

async function loginToken(baseUrl, email, password) {
  const { body } = await request(baseUrl, '/api/listener/login', {
    method: 'POST', headers: JSON_HDR, body: JSON.stringify({ email, password }),
  });
  return body.token;
}

// ─── Password reset ───────────────────────────────────────────────────────────

test('request-password-reset always answers ok and never reveals accounts', async () => {
  const db = freshDb();
  resetAuthLimiter();
  seedAccount(db, 'exists@example.com', 'password123');
  await withServer(async baseUrl => {
    for (const email of ['exists@example.com', 'nobody@example.com']) {
      const { res, body } = await request(baseUrl, '/api/listener/request-password-reset', {
        method: 'POST', headers: JSON_HDR, body: JSON.stringify({ email }),
      });
      assert.equal(res.status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.emailEnabled, false); // no SMTP in tests
    }
    // Without SMTP no reset rows are minted from the public route.
    assert.equal(db.prepare('SELECT COUNT(*) n FROM password_resets').get().n, 0);
  });
});

test('dashboard reset link completes the full reset flow exactly once', async () => {
  const db = freshDb();
  resetAuthLimiter();
  const listenerId = seedAccount(db, 'listener@example.com', 'oldpassword');
  await withServer(async baseUrl => {
    const link = await request(baseUrl, `/api/dashboard/accounts/${listenerId}/reset-link`, {
      method: 'POST', headers: DASH,
    });
    assert.equal(link.res.status, 200);
    assert.match(link.body.url, /#reset=[0-9a-f]{64}$/);
    assert.equal(link.body.email, 'listener@example.com');

    const token = link.body.url.split('#reset=')[1];

    // Raw token is never stored.
    assert.equal(db.prepare('SELECT COUNT(*) n FROM password_resets WHERE token_hash = ?').get(token).n, 0);

    const bad = await request(baseUrl, '/api/listener/reset-password', {
      method: 'POST', headers: JSON_HDR, body: JSON.stringify({ token: 'f'.repeat(64), password: 'newpassword1' }),
    });
    assert.equal(bad.res.status, 400);

    const short = await request(baseUrl, '/api/listener/reset-password', {
      method: 'POST', headers: JSON_HDR, body: JSON.stringify({ token, password: 'short' }),
    });
    assert.equal(short.res.status, 400);

    const ok = await request(baseUrl, '/api/listener/reset-password', {
      method: 'POST', headers: JSON_HDR, body: JSON.stringify({ token, password: 'newpassword1' }),
    });
    assert.equal(ok.res.status, 200);

    // Token is single-use.
    const reuse = await request(baseUrl, '/api/listener/reset-password', {
      method: 'POST', headers: JSON_HDR, body: JSON.stringify({ token, password: 'anotherpass1' }),
    });
    assert.equal(reuse.res.status, 400);

    assert.ok(await loginToken(baseUrl, 'listener@example.com', 'newpassword1'));
  });
});

test('expired reset tokens are rejected', async () => {
  const db = freshDb();
  resetAuthLimiter();
  const listenerId = seedAccount(db, 'l@example.com', 'oldpassword');
  await withServer(async baseUrl => {
    const { createPasswordReset } = require('../src/api/listener');
    const { token } = createPasswordReset(db, listenerId, 'dashboard');
    db.prepare('UPDATE password_resets SET expires_at = ? WHERE listener_id = ?')
      .run(new Date(Date.now() - 1000).toISOString(), listenerId);
    const { res } = await request(baseUrl, '/api/listener/reset-password', {
      method: 'POST', headers: JSON_HDR, body: JSON.stringify({ token, password: 'newpassword1' }),
    });
    assert.equal(res.status, 400);
  });
});

// ─── Account export + deletion ────────────────────────────────────────────────

test('listener export returns account data and requires auth', async () => {
  const db = freshDb();
  resetAuthLimiter();
  seedAccount(db, 'exporter@example.com', 'password123');
  await withServer(async baseUrl => {
    const anon = await request(baseUrl, '/api/listener/export');
    assert.equal(anon.res.status, 401);

    const token = await loginToken(baseUrl, 'exporter@example.com', 'password123');
    const { res, body } = await request(baseUrl, '/api/listener/export', {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-disposition'), /attachment/);
    assert.equal(body.account.email, 'exporter@example.com');
    assert.ok(Array.isArray(body.subscriptions));
    assert.ok(Array.isArray(body.vaultUnlocks));
  });
});

test('account deletion requires the password, scrubs PII, and revokes tokens', async () => {
  const db = freshDb();
  resetAuthLimiter();
  const listenerId = seedAccount(db, 'deleteme@example.com', 'password123');
  await withServer(async baseUrl => {
    const token = await loginToken(baseUrl, 'deleteme@example.com', 'password123');
    const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    const wrong = await request(baseUrl, '/api/listener/account', {
      method: 'DELETE', headers: auth, body: JSON.stringify({ password: 'wrong' }),
    });
    assert.equal(wrong.res.status, 401);

    const ok = await request(baseUrl, '/api/listener/account', {
      method: 'DELETE', headers: auth, body: JSON.stringify({ password: 'password123' }),
    });
    assert.equal(ok.res.status, 200);

    const row = db.prepare('SELECT email, is_active FROM listener_accounts WHERE id = ?').get(listenerId);
    assert.equal(row.email, `deleted-${listenerId}@account.invalid`);
    assert.equal(row.is_active, 0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM tokens WHERE listener_id = ?').get(listenerId).n, 0);

    // The revoked token no longer authenticates.
    const after = await request(baseUrl, '/api/listener/export', {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(after.res.status, 401);
  });
});

// ─── Subscription self-service guards ─────────────────────────────────────────

test('subscription cancel and portal require auth and an active subscription', async () => {
  const db = freshDb();
  resetAuthLimiter();
  seedAccount(db, 'nosub@example.com', 'password123');
  await withServer(async baseUrl => {
    const anonCancel = await request(baseUrl, '/api/payment/subscription/cancel', { method: 'POST', headers: JSON_HDR, body: '{}' });
    assert.equal(anonCancel.res.status, 401);

    const token = await loginToken(baseUrl, 'nosub@example.com', 'password123');
    const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const cancel = await request(baseUrl, '/api/payment/subscription/cancel', { method: 'POST', headers: auth, body: '{}' });
    assert.equal(cancel.res.status, 404);

    const portal = await request(baseUrl, '/api/payment/portal', { method: 'POST', headers: auth, body: '{}' });
    assert.equal(portal.res.status, 503); // Stripe not configured in tests
  });
});

// ─── CSV exports + backup ─────────────────────────────────────────────────────

test('CSV exports are dashboard-gated and escape spreadsheet formulas', async () => {
  const db = freshDb();
  resetAuthLimiter();
  db.prepare("INSERT INTO download_leads (email, platform) VALUES ('=HYPERLINK(1)', 'mac'), ('plain@example.com', 'win')").run();
  await withServer(async baseUrl => {
    const anon = await request(baseUrl, '/api/dashboard/export/download-leads.csv');
    assert.equal(anon.res.status, 401);

    const { res, text } = await request(baseUrl, '/api/dashboard/export/download-leads.csv', { headers: DASH });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/csv/);
    assert.match(text, /^email,platform,updates_opt_in,created_at/);
    assert.match(text, /'=HYPERLINK\(1\)/); // formula neutralized with leading quote
    assert.match(text, /plain@example\.com/);
  });
});

test('subscribers CSV lists only active subscriptions with real emails', async () => {
  const db = freshDb();
  resetAuthLimiter();
  const active = seedListener(db, 'active@example.com');
  const lapsed = seedListener(db, 'lapsed@example.com');
  const pending = seedListener(db, 'x@pending.paperweight.local');
  const insertSub = db.prepare(
    "INSERT INTO subscriptions (listener_id, tier, provider, provider_subscription_id, status, current_period_end) VALUES (?, 'pro', 'stripe', ?, ?, ?)"
  );
  insertSub.run(active, 'sub_active', 'active', new Date(Date.now() + 86400000).toISOString());
  insertSub.run(lapsed, 'sub_lapsed', 'expired', new Date(Date.now() - 86400000).toISOString());
  insertSub.run(pending, 'sub_pending', 'active', new Date(Date.now() + 86400000).toISOString());

  await withServer(async baseUrl => {
    const { text } = await request(baseUrl, '/api/dashboard/export/subscribers.csv', { headers: DASH });
    assert.match(text, /active@example\.com/);
    assert.doesNotMatch(text, /lapsed@example\.com/);
    assert.doesNotMatch(text, /pending\.paperweight\.local/);
  });
});

test('database backup endpoint streams a valid SQLite file', async () => {
  freshDb();
  resetAuthLimiter();
  await withServer(async baseUrl => {
    const res = await fetch(`${baseUrl}/api/dashboard/backup`, { headers: DASH });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-disposition'), /paperweight-backup-.*\.db/);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.equal(buf.subarray(0, 15).toString('utf8'), 'SQLite format 3');
  });
});

// ─── Settings + notifications config ──────────────────────────────────────────

test('dashboard settings round-trip and validate the webhook URL', async () => {
  freshDb();
  resetAuthLimiter();
  await withServer(async baseUrl => {
    const initial = await request(baseUrl, '/api/dashboard/settings', { headers: DASH });
    assert.equal(initial.res.status, 200);
    assert.deepEqual(initial.body, {
      notifyWebhookUrl: '', notifyLiveEnabled: true, feedEnabled: false, feedScope: 'podcasts', emailConfigured: false,
    });

    const bad = await request(baseUrl, '/api/dashboard/settings', {
      method: 'PUT', headers: DASH, body: JSON.stringify({ notifyWebhookUrl: 'ftp://nope' }),
    });
    assert.equal(bad.res.status, 400);

    const badScope = await request(baseUrl, '/api/dashboard/settings', {
      method: 'PUT', headers: DASH, body: JSON.stringify({ feedScope: 'everything' }),
    });
    assert.equal(badScope.res.status, 400);

    const ok = await request(baseUrl, '/api/dashboard/settings', {
      method: 'PUT', headers: DASH,
      body: JSON.stringify({ notifyWebhookUrl: 'https://discord.com/api/webhooks/1/x', notifyLiveEnabled: false, feedEnabled: true, feedScope: 'all' }),
    });
    assert.equal(ok.res.status, 200);

    const updated = await request(baseUrl, '/api/dashboard/settings', { headers: DASH });
    assert.deepEqual(updated.body, {
      notifyWebhookUrl: 'https://discord.com/api/webhooks/1/x', notifyLiveEnabled: false, feedEnabled: true, feedScope: 'all', emailConfigured: false,
    });
  });
});

test('supporterEmails only returns active real subscriber emails', () => {
  const db = freshDb();
  resetAuthLimiter();
  const { supporterEmails } = require('../src/notify');
  const yes = seedListener(db, 'supporter@example.com');
  const expired = seedListener(db, 'expired@example.com');
  const pending = seedListener(db, 'p@pending.paperweight.local');
  const free = seedListener(db, 'free@example.com');
  const insertSub = db.prepare(
    "INSERT INTO subscriptions (listener_id, tier, provider, provider_subscription_id, status, current_period_end) VALUES (?, 'pro', 'stripe', ?, ?, ?)"
  );
  insertSub.run(yes, 's1', 'active', new Date(Date.now() + 86400000).toISOString());
  insertSub.run(expired, 's2', 'expired', new Date(Date.now() - 86400000).toISOString());
  insertSub.run(pending, 's3', 'active', new Date(Date.now() + 86400000).toISOString());
  void free;

  assert.deepEqual(supporterEmails(db), ['supporter@example.com']);
});

// ─── RSS feed + enclosures ────────────────────────────────────────────────────

test('feed is 404 until enabled, then lists only public local media in scope', async () => {
  const db = freshDb();
  resetAuthLimiter();
  await withServer(async baseUrl => {
    assert.equal((await request(baseUrl, '/feed.xml')).res.status, 404);

    db.prepare("INSERT INTO app_settings (key, value) VALUES ('feed_enabled', '1'), ('feed_scope', 'podcasts')").run();
    seedMedia(db, { title: 'Public Episode', category: 'podcasts' });
    seedMedia(db, { title: 'Public Song', category: 'music' });
    seedMedia(db, { title: 'Secret Vault Cut', category: 'podcasts', visibility: 'vault' });
    seedMedia(db, { title: 'Members Only', category: 'podcasts', visibility: 'supporters_only' });
    db.prepare(
      "INSERT INTO media (filepath, filename, category, title, visibility) VALUES ('external://youtube/abc', 'ext', 'podcasts', 'External Import', 'public')"
    ).run();

    const podcastsOnly = await request(baseUrl, '/feed.xml');
    assert.equal(podcastsOnly.res.status, 200);
    assert.match(podcastsOnly.res.headers.get('content-type'), /application\/rss\+xml/);
    assert.match(podcastsOnly.text, /Public Episode/);
    assert.doesNotMatch(podcastsOnly.text, /Public Song/);      // out of scope
    assert.doesNotMatch(podcastsOnly.text, /Secret Vault Cut/); // gated
    assert.doesNotMatch(podcastsOnly.text, /Members Only/);     // gated
    assert.doesNotMatch(podcastsOnly.text, /External Import/);  // no local file

    db.prepare("UPDATE app_settings SET value = 'all' WHERE key = 'feed_scope'").run();
    const allPublic = await request(baseUrl, '/feed.xml');
    assert.match(allPublic.text, /Public Song/);
    assert.doesNotMatch(allPublic.text, /Secret Vault Cut/);
  });
});

test('enclosures serve only public in-scope files while the feed is enabled', async () => {
  const db = freshDb();
  resetAuthLimiter();
  // A real file inside the configured vault so safeVaultPath accepts it.
  const config = require('../src/config');
  fs.mkdirSync(config.vault.path, { recursive: true });
  const filePath = path.join(config.vault.path, 'episode.mp3');
  fs.writeFileSync(filePath, 'fake-audio-bytes');

  const pub = seedMedia(db, { title: 'Ep', category: 'podcasts', filepath: filePath });
  const vault = seedMedia(db, { title: 'V', category: 'podcasts', visibility: 'vault' });
  db.prepare("INSERT INTO app_settings (key, value) VALUES ('feed_enabled', '1'), ('feed_scope', 'podcasts')").run();

  await withServer(async baseUrl => {
    const ok = await request(baseUrl, `/feed/enclosure/${pub.id}`);
    assert.equal(ok.res.status, 200);
    assert.equal(ok.text, 'fake-audio-bytes');

    assert.equal((await request(baseUrl, `/feed/enclosure/${vault.id}`)).res.status, 404);

    db.prepare("UPDATE app_settings SET value = '0' WHERE key = 'feed_enabled'").run();
    assert.equal((await request(baseUrl, `/feed/enclosure/${pub.id}`)).res.status, 404);
  });
});

// ─── Embed page ───────────────────────────────────────────────────────────────

test('embed page is frameable while the app stays frame-denied', async () => {
  freshDb();
  resetAuthLimiter();
  await withServer(async baseUrl => {
    const embed = await request(baseUrl, '/embed');
    assert.equal(embed.res.status, 200);
    assert.equal(embed.res.headers.get('x-frame-options'), null);
    assert.match(embed.res.headers.get('content-security-policy'), /frame-ancestors \*/);
    assert.match(embed.text, /embed-play/);

    const app = await request(baseUrl, '/');
    assert.equal(app.res.headers.get('x-frame-options'), 'DENY');
    assert.match(app.res.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  });
});
