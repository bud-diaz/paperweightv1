// Papercut-adoption feature tests: welcome onboarding (listener profiles),
// public discover feed, genre browsing, ownership/price annotations, listener
// collection + purchases, creator earnings, audience export consent, and
// offline-save download gating.
process.env.PAPERWEIGHT_ALLOW_MISSING_ENV = 'true';
process.env.DASHBOARD_TOKEN = 'test-dashboard-token';
process.env.DOWNLOAD_SIGNING_SECRET = 'test-download-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { freshDb, seedMedia, seedListener, seedToken } = require('./helpers');
const { createApp } = require('../src/index');
const config = require('../src/config');
const { authLimiter } = require('../src/middleware/rateLimiter');

const DASH = { 'X-Dashboard-Token': 'test-dashboard-token' };

// The auth rate limiter is a process-wide singleton (10 req / 15 min); the
// onboarding tests in this file legitimately exceed that, so clear it between
// tests (same pattern as features.test.js).
function resetAuthLimiter() {
  for (const key of ['127.0.0.1', '::ffff:127.0.0.1', '::1']) {
    try { authLimiter.resetKey(key); } catch {}
  }
}

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

function post(baseUrl, pathname, payload, headers = {}) {
  return request(baseUrl, pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(payload),
  });
}

function bearer(token) {
  return { Authorization: `Bearer ${token}` };
}

function seedListenEvent(db, mediaId, seconds = 60) {
  db.prepare(
    "INSERT INTO listen_events (ip_hash, media_id, started_at, seconds) VALUES ('h', ?, datetime('now'), ?)"
  ).run(mediaId, seconds);
}

function seedUnlock(db, listenerId, { type = 'track', targetId = null, amount = 500 } = {}) {
  db.prepare(`
    INSERT INTO vault_unlocks (listener_id, unlock_type, target_id, amount_paid, payment_type, active)
    VALUES (?, ?, ?, ?, 'one_time', 1)
  `).run(listenerId, type, targetId, amount);
}

// ─── Welcome onboarding ───────────────────────────────────────────────────────

// Legacy welcome identity: a profile-only token minted by the retired /start
// endpoint. Seeded directly now that the endpoint is gone.
function seedProfile(db, { displayName = 'Legacy', email = null, marketingOptIn = 0 } = {}) {
  const tokenRow = seedToken(db);
  db.prepare(`
    INSERT INTO listener_profiles (display_name, email, marketing_opt_in, token_id, last_seen_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `).run(displayName, email, marketingOptIn, tokenRow.id);
  return { token: tokenRow.token, tokenId: tokenRow.id };
}

test('listener start is retired and mints nothing', async () => {
  const db = freshDb();
  resetAuthLimiter();
  await withServer(async baseUrl => {
    const { res } = await post(baseUrl, '/api/listener/start', { displayName: 'Alex' });
    assert.equal(res.status, 410);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM listener_profiles').get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tokens').get().n, 0);
  });
});

test('welcome register creates an account plus profile with consent', async () => {
  const db = freshDb();
  resetAuthLimiter();
  await withServer(async baseUrl => {
    const { res, body } = await post(baseUrl, '/api/listener/register', {
      email: 'Fan@Example.com', password: 'password123',
      displayName: '  Alex  ', marketingOptIn: true,
    });
    assert.equal(res.status, 201);
    assert.equal(body.tier, 'free');
    assert.ok(body.token);
    assert.match(res.headers.get('set-cookie') || '', /pw_token=/);

    const account = db.prepare('SELECT * FROM listener_accounts').get();
    assert.equal(account.email, 'fan@example.com');
    const profile = db.prepare('SELECT * FROM listener_profiles').get();
    assert.equal(profile.display_name, 'Alex');
    assert.equal(profile.email, 'fan@example.com');
    assert.equal(profile.marketing_opt_in, 1);
    assert.equal(profile.account_id, account.id);
  });
});

test('welcome register without consent leaves marketing opt-in off', async () => {
  const db = freshDb();
  resetAuthLimiter();
  await withServer(async baseUrl => {
    const { res } = await post(baseUrl, '/api/listener/register', {
      email: 'quiet@example.com', password: 'password123', displayName: 'NoConsent',
    });
    assert.equal(res.status, 201);
    const profile = db.prepare('SELECT * FROM listener_profiles').get();
    assert.equal(profile.marketing_opt_in, 0);
  });
});

test('register validates email, password, and display name', async () => {
  freshDb();
  resetAuthLimiter();
  await withServer(async baseUrl => {
    const badEmail = await post(baseUrl, '/api/listener/register',
      { email: 'not-an-email', password: 'password123' });
    assert.equal(badEmail.res.status, 400);

    const shortPass = await post(baseUrl, '/api/listener/register',
      { email: 'ok@example.com', password: 'short' });
    assert.equal(shortPass.res.status, 400);

    const oversized = await post(baseUrl, '/api/listener/register',
      { email: 'ok@example.com', password: 'password123', displayName: 'x'.repeat(51) });
    assert.equal(oversized.res.status, 400);
  });
});

test('me answers for a legacy profile token and refreshes last_seen_at', async () => {
  const db = freshDb();
  resetAuthLimiter();
  const seeded = seedProfile(db, { displayName: 'Repeat', email: 'repeat@example.com' });
  await withServer(async baseUrl => {
    db.prepare("UPDATE listener_profiles SET last_seen_at = '2020-01-01 00:00:00'").run();

    const me = await request(baseUrl, '/api/listener/me', { headers: bearer(seeded.token) });
    assert.equal(me.res.status, 200);
    assert.equal(me.body.displayName, 'Repeat');
    assert.equal(me.body.email, 'repeat@example.com');
    assert.equal(me.body.hasAccount, false);
    assert.equal(me.body.tier, 'free');

    const seen = db.prepare('SELECT last_seen_at FROM listener_profiles').get().last_seen_at;
    assert.notEqual(seen, '2020-01-01 00:00:00');
  });
});

test('registering links an unclaimed profile to the new account', async () => {
  const db = freshDb();
  resetAuthLimiter();
  const seeded = seedProfile(db, { displayName: 'Upgrader' });
  await withServer(async baseUrl => {
    const reg = await post(baseUrl, '/api/listener/register',
      { email: 'up@example.com', password: 'password123' },
      { Cookie: `pw_token=${seeded.token}` });
    assert.equal(reg.res.status, 201);

    const profile = db.prepare('SELECT * FROM listener_profiles').get();
    const account = db.prepare('SELECT id FROM listener_accounts WHERE email = ?').get('up@example.com');
    assert.equal(profile.account_id, account.id);
    // The account email is copied onto the profile for the audience export.
    assert.equal(profile.email, 'up@example.com');

    // The account's /me now carries the profile display name.
    const me = await request(baseUrl, '/api/listener/me', { headers: bearer(reg.body.token) });
    assert.equal(me.body.displayName, 'Upgrader');
    assert.equal(me.body.hasAccount, true);
  });
});

test('profile deletion removes the profile row and its token', async () => {
  const db = freshDb();
  resetAuthLimiter();
  const seeded = seedProfile(db, { displayName: 'Gone', email: 'gone@example.com', marketingOptIn: 1 });
  await withServer(async baseUrl => {
    const del = await request(baseUrl, '/api/listener/profile', {
      method: 'DELETE', headers: bearer(seeded.token),
    });
    assert.equal(del.res.status, 200);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM listener_profiles').get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tokens').get().n, 0);
  });
});

// ─── Discover + browse ────────────────────────────────────────────────────────

test('discover exposes only public media', async () => {
  const db = freshDb();
  const pub = seedMedia(db, { title: 'Public Hit' });
  const sup = seedMedia(db, { title: 'Supporters Secret', visibility: 'supporters_only' });
  const vault = seedMedia(db, { title: 'Vault Secret', visibility: 'vault' });
  seedListenEvent(db, pub.id, 300);
  seedListenEvent(db, sup.id, 900);
  seedListenEvent(db, vault.id, 900);

  await withServer(async baseUrl => {
    const { res, body } = await request(baseUrl, '/api/library/discover');
    assert.equal(res.status, 200);

    const allTitles = [...body.trending, ...body.newReleases].map(t => t.title);
    assert.ok(allTitles.includes('Public Hit'));
    assert.ok(!allTitles.includes('Supporters Secret'));
    assert.ok(!allTitles.includes('Vault Secret'));
    assert.equal(body.trending[0].title, 'Public Hit');
    assert.ok(body.trending[0].plays >= 1);
  });
});

test('library genre filter and genres list work', async () => {
  const db = freshDb();
  const a = seedMedia(db, { title: 'Ambient One' });
  const b = seedMedia(db, { title: 'Rock One' });
  db.prepare("UPDATE media SET genre = 'Ambient' WHERE id = ?").run(a.id);
  db.prepare("UPDATE media SET genre = 'Rock' WHERE id = ?").run(b.id);

  await withServer(async baseUrl => {
    const genres = await request(baseUrl, '/api/library/genres');
    assert.equal(genres.res.status, 200);
    assert.deepEqual(genres.body.genres.map(g => g.genre).sort(), ['Ambient', 'Rock']);

    const filtered = await request(baseUrl, '/api/library?genre=ambient');
    assert.equal(filtered.body.items.length, 1);
    assert.equal(filtered.body.items[0].title, 'Ambient One');
    assert.equal(filtered.body.items[0].genre, 'Ambient');
  });
});

test('library annotates vault items with price and unlocked state', async () => {
  const db = freshDb();
  const track = seedMedia(db, { title: 'Priced Vault', visibility: 'vault' });
  db.prepare(
    'INSERT INTO vault_prices (content_id, suggested_price, minimum_price) VALUES (?, 700, 300)'
  ).run(track.id);

  const buyerId = seedListener(db);
  seedUnlock(db, buyerId, { targetId: track.id, amount: 300 });
  const buyerToken = seedToken(db, { listenerId: buyerId });

  await withServer(async baseUrl => {
    // Anonymous: discoverable, locked, priced.
    const anon = await request(baseUrl, '/api/library');
    const anonItem = anon.body.items.find(i => i.id === track.id);
    assert.equal(anonItem.unlocked, false);
    assert.equal(anonItem.price.minimum, 300);
    assert.equal(anonItem.price.suggested, 700);

    // The buyer sees it as owned.
    const owned = await request(baseUrl, '/api/library', { headers: bearer(owner(buyerToken)) });
    const ownedItem = owned.body.items.find(i => i.id === track.id);
    assert.equal(ownedItem.unlocked, true);
  });

  function owner(t) { return t.token; }
});

// ─── Collection + purchases ───────────────────────────────────────────────────

test('collection requires auth and only shows the callers unlocks', async () => {
  const db = freshDb();
  const track = seedMedia(db, { title: 'Owned Track', visibility: 'vault' });
  const other = seedMedia(db, { title: 'Other Track', visibility: 'vault' });

  const ownerId = seedListener(db);
  seedUnlock(db, ownerId, { targetId: track.id });
  const ownerToken = seedToken(db, { listenerId: ownerId });

  const strangerId = seedListener(db);
  const strangerToken = seedToken(db, { listenerId: strangerId });

  await withServer(async baseUrl => {
    const anon = await request(baseUrl, '/api/listener/collection');
    assert.equal(anon.res.status, 401);

    const mine = await request(baseUrl, '/api/listener/collection', { headers: bearer(ownerToken.token) });
    assert.equal(mine.res.status, 200);
    assert.deepEqual(mine.body.items.map(i => i.title), ['Owned Track']);
    assert.ok(!mine.body.items.some(i => i.id === other.id));

    const theirs = await request(baseUrl, '/api/listener/collection', { headers: bearer(strangerToken.token) });
    assert.equal(theirs.body.items.length, 0);
  });
});

test('purchases lists the accounts unlock history with amounts', async () => {
  const db = freshDb();
  const track = seedMedia(db, { title: 'Bought Track', visibility: 'vault' });
  const listenerId = seedListener(db);
  seedUnlock(db, listenerId, { targetId: track.id, amount: 450 });
  const token = seedToken(db, { listenerId });

  await withServer(async baseUrl => {
    const { res, body } = await request(baseUrl, '/api/listener/purchases', { headers: bearer(token.token) });
    assert.equal(res.status, 200);
    assert.equal(body.purchases.length, 1);
    assert.equal(body.purchases[0].title, 'Bought Track');
    assert.equal(body.purchases[0].amountPaidCents, 450);
    assert.equal(body.purchases[0].unlockType, 'track');
  });
});

// ─── Earnings + audience ──────────────────────────────────────────────────────

test('earnings requires dashboard auth and aggregates unlocks and tips', async () => {
  const db = freshDb();
  const track = seedMedia(db, { title: 'Seller', visibility: 'vault' });
  const l1 = seedListener(db);
  const l2 = seedListener(db);
  seedUnlock(db, l1, { targetId: track.id, amount: 500 });
  seedUnlock(db, l2, { targetId: track.id, amount: 700 });
  db.prepare('INSERT INTO tips (amount_cents) VALUES (300)').run();

  await withServer(async baseUrl => {
    const denied = await request(baseUrl, '/api/dashboard/earnings');
    assert.equal(denied.res.status, 401);

    const { res, body } = await request(baseUrl, '/api/dashboard/earnings', { headers: DASH });
    assert.equal(res.status, 200);
    assert.equal(body.totals.unitsSold, 2);
    assert.equal(body.totals.unlockRevenueCents, 1200);
    assert.equal(body.totals.tipRevenueCents, 300);
    assert.equal(body.totals.revenueCents, 1500);
    assert.equal(body.unlocks[0].title, 'Seller');
    assert.equal(body.unlocks[0].unitsSold, 2);
  });
});

test('audience export is strictly opt-in and deduplicates by email', async () => {
  const db = freshDb();
  db.prepare(
    "INSERT INTO listener_profiles (display_name, email, marketing_opt_in) VALUES ('OptIn', 'fan@example.com', 1)"
  ).run();
  db.prepare(
    "INSERT INTO listener_profiles (display_name, email, marketing_opt_in) VALUES ('NoOptIn', 'quiet@example.com', 0)"
  ).run();
  // Duplicate of the profile email plus a lead-only opt-in.
  db.prepare("INSERT INTO download_leads (email, updates_opt_in) VALUES ('fan@example.com', 1)").run();
  db.prepare("INSERT INTO download_leads (email, updates_opt_in) VALUES ('lead@example.com', 1)").run();
  db.prepare("INSERT INTO download_leads (email, updates_opt_in) VALUES ('silent@example.com', 0)").run();

  await withServer(async baseUrl => {
    const denied = await request(baseUrl, '/api/dashboard/audience');
    assert.equal(denied.res.status, 401);

    const { body } = await request(baseUrl, '/api/dashboard/audience', { headers: DASH });
    const emails = body.contacts.map(c => c.email).sort();
    assert.deepEqual(emails, ['fan@example.com', 'lead@example.com']);
    assert.equal(body.total, 2);

    const csv = await request(baseUrl, '/api/dashboard/export/audience.csv', { headers: DASH });
    assert.equal(csv.res.status, 200);
    assert.match(csv.text, /fan@example\.com/);
    assert.match(csv.text, /lead@example\.com/);
    assert.ok(!csv.text.includes('quiet@example.com'));
    assert.ok(!csv.text.includes('silent@example.com'));
  });
});

// ─── Offline saves ────────────────────────────────────────────────────────────

test('offline-allowed tracks are downloadable at access level, others stay subscriber-gated', async () => {
  const db = freshDb();

  // Real file inside the vault so the signed URL can be served.
  fs.mkdirSync(config.vault.path, { recursive: true });
  const filepath = path.join(config.vault.path, 'offline-ok.mp3');
  fs.writeFileSync(filepath, 'fake-audio-bytes');

  const savable = seedMedia(db, { title: 'Savable', filepath });
  db.prepare('UPDATE media SET offline_allowed = 1 WHERE id = ?').run(savable.id);
  const gated = seedMedia(db, { title: 'Gated' }); // public but offline_allowed = 0

  const freeToken = seedToken(db, { tier: 'free' });

  await withServer(async baseUrl => {
    // Anonymous visitors can stream, but cannot request a signed save URL.
    const anon = await request(baseUrl, `/api/library/${savable.id}/download`);
    assert.equal(anon.res.status, 401);

    // Free listener cannot download a normal public track…
    const denied = await request(baseUrl, `/api/library/${gated.id}/download`, { headers: bearer(freeToken.token) });
    assert.equal(denied.res.status, 403);

    // …but can download (and therefore locally save) an offline-allowed one.
    const ok = await request(baseUrl, `/api/library/${savable.id}/download`, { headers: bearer(freeToken.token) });
    assert.equal(ok.res.status, 200);
    assert.ok(ok.body.signedUrl);

    const file = await request(baseUrl, ok.body.signedUrl);
    assert.equal(file.res.status, 200);
    assert.equal(file.text, 'fake-audio-bytes');
  });
});
