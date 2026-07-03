// Regression tests for the security-hardening pass:
//   - API tokens are stored only as a hash, never plaintext (I1)
//   - dashboard 2FA recovery codes actually validate (correctness bug)
//   - a used TOTP code cannot be replayed (L5)
process.env.PAPERWEIGHT_ALLOW_MISSING_ENV = 'true';
process.env.DASHBOARD_TOKEN = 'test-dashboard-token';
process.env.DOWNLOAD_SIGNING_SECRET = 'test-download-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const { freshDb, getDb } = require('./helpers');
const { createToken, validateToken } = require('../src/auth');
const { computeTOTP } = require('../src/auth/totp');
const { createApp } = require('../src/index');

const DASH_HEADER = { 'X-Dashboard-Token': 'test-dashboard-token', 'Content-Type': 'application/json' };

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

async function json(baseUrl, pathname, options = {}) {
  const res = await fetch(`${baseUrl}${pathname}`, options);
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch {}
  return { res, body };
}

function currentTotp(secret) {
  return computeTOTP(secret, Math.floor(Date.now() / 1000 / 30));
}

test('API tokens are stored only as a hash and validate by hash', () => {
  const db = freshDb();
  const raw = createToken('Test subscriber', 'pro');

  // The raw token is never persisted — the stored columns hold its SHA-256 hash.
  const expectedHash = crypto.createHash('sha256').update(raw).digest('hex');
  const row = db.prepare('SELECT token, token_hash FROM tokens ORDER BY id DESC LIMIT 1').get();
  assert.equal(row.token_hash, expectedHash);
  assert.notEqual(row.token, raw);
  assert.equal(row.token, expectedHash);

  // Presenting the raw token still authenticates.
  const validated = validateToken(raw);
  assert.ok(validated);
  assert.equal(validated.tier, 'pro');

  // A bogus token does not.
  assert.equal(validateToken('deadbeef'), null);
});

test('2FA recovery codes validate, and TOTP codes cannot be replayed', async () => {
  freshDb();
  await withServer(async baseUrl => {
    // Begin setup — get the TOTP secret.
    const setup = await json(baseUrl, '/api/dashboard/2fa/setup', { method: 'POST', headers: DASH_HEADER });
    assert.equal(setup.res.status, 200);
    const secret = setup.body.secret;

    // Confirm setup with a live TOTP code — receive recovery codes.
    const confirm = await json(baseUrl, '/api/dashboard/2fa/confirm', {
      method: 'POST', headers: DASH_HEADER, body: JSON.stringify({ code: currentTotp(secret) }),
    });
    assert.equal(confirm.res.status, 200);
    assert.ok(Array.isArray(confirm.body.recoveryCodes) && confirm.body.recoveryCodes.length > 0);
    const recoveryCode = confirm.body.recoveryCodes[0];

    // With 2FA enabled, login now returns a challenge instead of a session.
    const login1 = await json(baseUrl, '/api/auth/dashboard/login', { method: 'POST', headers: DASH_HEADER });
    assert.equal(login1.res.status, 200);
    assert.ok(login1.body.requires2FA);
    assert.ok(login1.body.challenge);

    // A recovery code unlocks the dashboard (regression: these used to never match).
    const rec = await json(baseUrl, '/api/auth/dashboard/verify-2fa', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challenge: login1.body.challenge, code: recoveryCode }),
    });
    assert.equal(rec.res.status, 200);
    assert.ok(rec.body.usedRecoveryCode);

    // A live TOTP code works once...
    const code = currentTotp(secret);
    const login2 = await json(baseUrl, '/api/auth/dashboard/login', { method: 'POST', headers: DASH_HEADER });
    const first = await json(baseUrl, '/api/auth/dashboard/verify-2fa', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challenge: login2.body.challenge, code }),
    });
    assert.equal(first.res.status, 200);

    // ...but replaying that same code is rejected (counter is consumed).
    const login3 = await json(baseUrl, '/api/auth/dashboard/login', { method: 'POST', headers: DASH_HEADER });
    const replay = await json(baseUrl, '/api/auth/dashboard/verify-2fa', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challenge: login3.body.challenge, code }),
    });
    assert.equal(replay.res.status, 401);
  });
});
