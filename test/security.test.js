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
const fs = require('fs');
const path = require('path');

const { freshDb, getDb, seedMedia } = require('./helpers');
const { createToken, validateToken } = require('../src/auth');
const { computeTOTP } = require('../src/auth/totp');
const { createApp } = require('../src/index');
const config = require('../src/config');
const { ARTWORK_DIR } = require('../src/api/library');
const { csvEscape, updateEnvKey } = require('../src/api/dashboard');
const { publicBaseUrl } = require('../src/runtime/base-url');
const {
  isAllowedExternalUrl,
  isTrustedAppUrl,
  isTrustedSetupUrl,
} = require('../electron/security');

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

function cookieValue(setCookie) {
  return String(setCookie || '').split(';')[0];
}

function escapeRe(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

test('dashboard password reset links ignore poisoned Host headers', async () => {
  const db = freshDb();
  const listener = db.prepare(
    'INSERT INTO listener_accounts (email, password_hash) VALUES (?, ?)'
  ).run('reset@example.com', 'x');

  await withServer(async baseUrl => {
    const link = await json(baseUrl, `/api/dashboard/accounts/${listener.lastInsertRowid}/reset-link`, {
      method: 'POST',
      headers: {
        ...DASH_HEADER,
        Host: 'evil.example',
      },
    });
    assert.equal(link.res.status, 200);
    assert.match(link.body.url, new RegExp(`^${escapeRe(publicBaseUrl())}/#reset=[0-9a-f]{64}$`));
    assert.ok(!link.body.url.includes('evil.example'));
  });
});

test('generated station icon serves the branded PNG without reflecting station name', async () => {
  freshDb();
  const originalName = config.station.name;
  config.station.name = '<svg onload=alert(1)>';
  try {
    await withServer(async baseUrl => {
      const res = await fetch(`${baseUrl}/icon.png`);
      const body = Buffer.from(await res.arrayBuffer());
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
      assert.match(res.headers.get('content-type') || '', /^image\/png/);
      assert.deepEqual([...body.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      assert.ok(!body.toString('utf8').includes('<svg onload=alert(1)>'));
    });
  } finally {
    config.station.name = originalName;
  }
});

test('artwork URLs only redirect to valid http and https URLs', async () => {
  const db = freshDb();
  const media = seedMedia(db, { filepath: path.join(config.vault.path, 'missing-artwork.mp3') });

  await withServer(async baseUrl => {
    const cases = ['javascript:alert(1)', '//evil.example/art.jpg', 'http://[broken'];
    for (const artworkUrl of cases) {
      db.prepare('UPDATE media SET artwork_url = ? WHERE id = ?').run(artworkUrl, media.id);
      const denied = await fetch(`${baseUrl}/api/library/${media.id}/artwork`, { redirect: 'manual' });
      assert.equal(denied.status, 404);
      assert.equal(denied.headers.get('location'), null);
    }

    db.prepare('UPDATE media SET artwork_url = ? WHERE id = ?').run('https://cdn.example/art.jpg', media.id);
    const allowed = await fetch(`${baseUrl}/api/library/${media.id}/artwork`, { redirect: 'manual' });
    assert.equal(allowed.status, 302);
    assert.equal(allowed.headers.get('location'), 'https://cdn.example/art.jpg');
  });
});

test('dashboard rejects invalid artwork_url updates', async () => {
  const db = freshDb();
  const media = seedMedia(db);

  await withServer(async baseUrl => {
    const rejected = await json(baseUrl, `/api/dashboard/media/${media.id}`, {
      method: 'PATCH',
      headers: DASH_HEADER,
      body: JSON.stringify({ artwork_url: 'javascript:alert(1)' }),
    });
    assert.equal(rejected.res.status, 400);

    const accepted = await json(baseUrl, `/api/dashboard/media/${media.id}`, {
      method: 'PATCH',
      headers: DASH_HEADER,
      body: JSON.stringify({ artwork_url: 'https://cdn.example/art.jpg' }),
    });
    assert.equal(accepted.res.status, 200);
  });
});

test('spoofed artwork image uploads are rejected and temp files are removed', async () => {
  freshDb();
  fs.mkdirSync(ARTWORK_DIR, { recursive: true });

  await withServer(async baseUrl => {
    const form = new FormData();
    form.append('artwork', new Blob(['not an image'], { type: 'image/png' }), 'spoof.png');
    const res = await fetch(`${baseUrl}/api/dashboard/media/123/artwork`, {
      method: 'POST',
      headers: { 'X-Dashboard-Token': process.env.DASHBOARD_TOKEN },
      body: form,
    });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.match(body.error, /not a supported image file/);
    const leftovers = fs.readdirSync(ARTWORK_DIR).filter(name => name.includes('_tmp_'));
    assert.deepEqual(leftovers, []);
  });
});

test('station URL update rejects newline-injected values before writing .env', async () => {
  const db = freshDb();
  // Seed a registered station with a known-good URL.
  db.prepare(
    "INSERT INTO station_registry (id, slug, url) VALUES (1, 'teststation', 'https://good.example/')"
  ).run();

  await withServer(async baseUrl => {
    const injected = await json(baseUrl, '/api/dashboard/station/url', {
      method: 'PUT',
      headers: DASH_HEADER,
      body: JSON.stringify({ url: 'https://evil.example/\nSMTP_HOST=attacker.example' }),
    });
    assert.equal(injected.res.status, 400);

    // The registered URL is left untouched — nothing was persisted.
    const row = db.prepare('SELECT url FROM station_registry WHERE id = 1').get();
    assert.equal(row.url, 'https://good.example/');
  });
});

test('updateEnvKey refuses values carrying a newline or hash', () => {
  assert.throws(() => updateEnvKey('STATION_PUBLIC_URL', 'https://x/\nSMTP_HOST=evil'), /newline/);
  assert.throws(() => updateEnvKey('STATION_PUBLIC_URL', 'https://x/\rFOO=bar'), /newline/);
  assert.throws(() => updateEnvKey('STATION_PUBLIC_URL', 'value # comment'), /newline/);
});

test('csvEscape neutralizes leading formula and carriage-return characters', () => {
  // A leading =, +, -, @, tab, or CR is prefixed with an apostrophe so a
  // spreadsheet cannot execute it as a formula.
  assert.equal(csvEscape('=cmd'), "'=cmd");
  const cr = csvEscape('\r=HYPERLINK(0)');
  assert.ok(cr.includes("'"), 'CR-prefixed value should be apostrophe-guarded');
  assert.ok(!cr.startsWith('\r'), 'CR-prefixed value should not start with a bare CR');
});

test('Electron desktop trust checks reject untrusted navigation and external URLs', () => {
  const desktopConfig = { host: '127.0.0.1', port: 3456 };

  assert.equal(isTrustedAppUrl('http://127.0.0.1:3456/', desktopConfig), true);
  assert.equal(isTrustedAppUrl('http://127.0.0.1:3456/api/health', desktopConfig), true);
  assert.equal(isTrustedAppUrl('http://127.0.0.1:3457/', desktopConfig), false);
  assert.equal(isTrustedAppUrl('http://evil.example:3456/', desktopConfig), false);
  assert.equal(isTrustedAppUrl('https://127.0.0.1:3456/', desktopConfig), false);
  assert.equal(isTrustedAppUrl('javascript:alert(1)', desktopConfig), false);

  assert.equal(isTrustedSetupUrl('file:///opt/Paperweight/resources/app.asar/renderer/setup.html'), true);
  assert.equal(isTrustedSetupUrl('file:///tmp/renderer/not-setup.html'), false);
  assert.equal(isTrustedSetupUrl('http://127.0.0.1:3456/renderer/setup.html'), false);

  assert.equal(isAllowedExternalUrl('https://github.com/bud-diaz/paper-packs/releases/latest', ['github.com']), true);
  assert.equal(isAllowedExternalUrl('https://docs.github.com/', ['github.com']), true);
  assert.equal(isAllowedExternalUrl('javascript:alert(1)', ['github.com']), false);
  assert.equal(isAllowedExternalUrl('http://github.com/bud-diaz/paper-packs/releases/latest', ['github.com']), false);
  assert.equal(isAllowedExternalUrl('https://github.com.evil.example/', ['github.com']), false);
});

test('listener token logout paths clear cookies with matching attributes', async () => {
  freshDb();
  const originalHttps = config.https;
  config.https = true;
  try {
    await withServer(async baseUrl => {
      const tokenLogout = await fetch(`${baseUrl}/api/tokens/logout`, { method: 'POST' });
      const tokenCookie = tokenLogout.headers.get('set-cookie');
      assert.match(tokenCookie, /^pw_token=/);
      assert.match(tokenCookie, /Secure/);
      assert.match(tokenCookie, /SameSite=Strict/);
      assert.match(tokenCookie, /Expires=Thu, 01 Jan 1970 00:00:00 GMT/);

      const register = await json(baseUrl, '/api/listener/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'delete@example.com', password: 'password123' }),
      });
      assert.equal(register.res.status, 201);

      const listenerLogout = await fetch(`${baseUrl}/api/listener/logout`, { method: 'POST' });
      const listenerCookie = listenerLogout.headers.get('set-cookie');
      assert.match(listenerCookie, /Secure/);
      assert.match(listenerCookie, /SameSite=Strict/);

      const accountDelete = await fetch(`${baseUrl}/api/listener/account`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${register.body.token}`,
        },
        body: JSON.stringify({ password: 'password123' }),
      });
      assert.equal(accountDelete.status, 200);
      const accountCookie = accountDelete.headers.get('set-cookie');
      assert.equal(cookieValue(accountCookie), 'pw_token=');
      assert.match(accountCookie, /Secure/);
      assert.match(accountCookie, /SameSite=Strict/);
    });
  } finally {
    config.https = originalHttps;
  }
});
