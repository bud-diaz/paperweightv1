// HTTP integration tests — exercise the real API router over a live ephemeral
// server using fetch. Covers health, dashboard auth, token redeem, listener
// account lifecycle, library visibility, gated downloads, and upload rejection.

const os = require('os');
const path = require('path');

// Must be set BEFORE requiring helpers (src/config reads these once at load).
process.env.DASHBOARD_TOKEN = 'test-dashboard-token';
process.env.VAULT_PATH = path.join(os.tmpdir(), `pw-itest-vault-${process.pid}`);

const test = require('node:test');
const assert = require('node:assert');
const { before, after, beforeEach } = require('node:test');
const { freshDb, getDb, seedMedia, seedListener, seedToken, createTestServer } = require('./helpers');

const DASH = { 'X-Dashboard-Token': 'test-dashboard-token' };

let base, close;

before(async () => { ({ base, close } = await createTestServer()); });
after(async () => { if (close) await close(); });
beforeEach(() => { freshDb(); });

function get(p, headers) { return fetch(base + p, { headers }); }
function postJson(p, body, headers = {}) {
  return fetch(base + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

// ─── Health ───────────────────────────────────────────────────────────────────

test('GET /api/health returns ok with station and version', async () => {
  const res = await get('/api/health');
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.status, 'ok');
  assert.ok('station' in body && 'version' in body);
});

// ─── Dashboard auth ─────────────────────────────────────────────────────────────

test('dashboard routes reject a missing/wrong token and accept the right one', async () => {
  assert.strictEqual((await get('/api/dashboard/vault')).status, 401);
  assert.strictEqual((await get('/api/dashboard/vault', { 'X-Dashboard-Token': 'nope' })).status, 401);

  const ok = await get('/api/dashboard/vault', DASH);
  assert.strictEqual(ok.status, 200);
  const body = await ok.json();
  assert.ok('totalFiles' in body, 'authenticated dashboard returns vault stats');
});

// ─── Token redeem / me ──────────────────────────────────────────────────────────

test('token redeem rejects garbage and accepts a valid token', async () => {
  const db = freshDb();
  const tok = seedToken(db, { tier: 'subscriber' });

  assert.strictEqual((await postJson('/api/tokens/redeem', {})).status, 400);
  assert.strictEqual((await postJson('/api/tokens/redeem', { token: 'invalid' })).status, 401);

  const res = await postJson('/api/tokens/redeem', { token: tok.token });
  assert.strictEqual(res.status, 200);
  assert.strictEqual((await res.json()).tier, 'subscriber');
  assert.ok((res.headers.get('set-cookie') || '').includes('pw_token'), 'redeem sets the pw_token cookie');
});

test('GET /api/tokens/me reflects the bearer tier', async () => {
  const db = freshDb();
  const tok = seedToken(db, { tier: 'pro' });

  const anon = await (await get('/api/tokens/me')).json();
  assert.strictEqual(anon.authenticated, false);
  assert.strictEqual(anon.tier, 'free');

  const authed = await (await get('/api/tokens/me', { Authorization: `Bearer ${tok.token}` })).json();
  assert.strictEqual(authed.authenticated, true);
  assert.strictEqual(authed.tier, 'pro');
});

// ─── Listener account lifecycle ─────────────────────────────────────────────────

test('listener register / login / me / password validation', async () => {
  freshDb();
  const email = 'fan@example.com';

  // Weak password and bad email are rejected.
  assert.strictEqual((await postJson('/api/listener/register', { email, password: 'short' })).status, 400);
  assert.strictEqual((await postJson('/api/listener/register', { email: 'nope', password: 'longenough1' })).status, 400);

  // Successful registration returns a free token.
  const reg = await postJson('/api/listener/register', { email, password: 'longenough1' });
  assert.strictEqual(reg.status, 201);
  const { token } = await reg.json();
  assert.ok(token);

  // Duplicate registration is a conflict.
  assert.strictEqual((await postJson('/api/listener/register', { email, password: 'longenough1' })).status, 409);

  // Wrong password fails; correct password succeeds.
  assert.strictEqual((await postJson('/api/listener/login', { email, password: 'wrongpass1' })).status, 401);
  assert.strictEqual((await postJson('/api/listener/login', { email, password: 'longenough1' })).status, 200);

  // /me requires auth and returns the account.
  assert.strictEqual((await get('/api/listener/me')).status, 401);
  const me = await (await get('/api/listener/me', { Authorization: `Bearer ${token}` })).json();
  assert.strictEqual(me.email, email);
  assert.strictEqual(me.tier, 'free');

  // Password change enforces the minimum length.
  const short = await fetch(base + '/api/listener/password', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ password: 'x' }),
  });
  assert.strictEqual(short.status, 400);
});

// ─── Library visibility + gated download ─────────────────────────────────────────

test('library structure hides supporters-only from free, shows it to subscribers', async () => {
  const db = freshDb();
  seedMedia(db, { visibility: 'public', title: 'Pub' });
  seedMedia(db, { visibility: 'supporters_only', title: 'Sup' });
  seedMedia(db, { visibility: 'vault', title: 'Vault' });
  const sub = seedToken(db, { tier: 'subscriber' });

  const freeView = await (await get('/api/library/structure')).json();
  const freeTitles = freeView.standalone.map(t => t.title);
  assert.ok(freeTitles.includes('Pub'));
  assert.ok(freeTitles.includes('Vault'), 'vault items are discoverable (shown locked)');
  assert.ok(!freeTitles.includes('Sup'), 'supporters-only is hidden from free listeners');

  const subView = await (await get('/api/library/structure', { Authorization: `Bearer ${sub.token}` })).json();
  assert.ok(subView.standalone.map(t => t.title).includes('Sup'), 'subscriber sees supporters-only');
});

test('gated signed-url download is denied to a free listener', async () => {
  const db = freshDb();
  const media = seedMedia(db, { visibility: 'supporters_only' });
  const res = await get(`/api/library/${media.id}/signed-url`);
  assert.strictEqual(res.status, 403);
});

// ─── Upload rejection ────────────────────────────────────────────────────────────

test('dashboard upload rejects a non audio/video file type', async () => {
  freshDb();
  const fd = new FormData();
  fd.set('category', 'music');
  fd.set('media', new Blob(['this is not media'], { type: 'text/plain' }), 'note.txt');

  const res = await fetch(base + '/api/dashboard/upload', {
    method: 'POST',
    headers: DASH,
    body: fd,
  });
  assert.strictEqual(res.status, 400);
  assert.match((await res.json()).error, /Unsupported file type/i);
});

test('dashboard upload requires the dashboard token', async () => {
  const fd = new FormData();
  fd.set('media', new Blob(['x'], { type: 'audio/mpeg' }), 'a.mp3');
  const res = await fetch(base + '/api/dashboard/upload', { method: 'POST', body: fd });
  assert.strictEqual(res.status, 401);
});
