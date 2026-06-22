process.env.PAPERWEIGHT_ALLOW_MISSING_ENV = 'true';
process.env.DASHBOARD_TOKEN = 'test-dashboard-token';

const test = require('node:test');
const assert = require('node:assert/strict');

const { freshDb, seedToken } = require('./helpers');
const { createApp } = require('../src/index');
const { hashCode } = require('../src/auth/totp');

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

test('dashboard 2FA challenge can only be consumed once', async () => {
  const db = freshDb();
  const recoveryCode = 'ABCD1234EFGH';
  db.prepare(`
    INSERT INTO dashboard_2fa (id, secret, enabled, recovery_codes)
    VALUES (1, 'JBSWY3DPEHPK3PXP', 1, ?)
  `).run(JSON.stringify([hashCode(recoveryCode)]));

  await withServer(async baseUrl => {
    const login = await request(baseUrl, '/api/auth/dashboard/login', {
      method: 'POST',
      headers: { 'X-Dashboard-Token': process.env.DASHBOARD_TOKEN },
    });

    assert.equal(login.res.status, 200);
    assert.equal(login.body.requires2FA, true);
    assert.equal(typeof login.body.challenge, 'string');

    const verifyOptions = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challenge: login.body.challenge, code: recoveryCode }),
    };
    const results = await Promise.all([
      request(baseUrl, '/api/auth/dashboard/verify-2fa', verifyOptions),
      request(baseUrl, '/api/auth/dashboard/verify-2fa', verifyOptions),
    ]);

    const statuses = results.map(result => result.res.status).sort();
    assert.deepEqual(statuses, [200, 401]);
    assert.equal(results.filter(result => /pw_dashboard_session=/.test(result.res.headers.get('set-cookie') || '')).length, 1);
  });
});

test('token redemption is rate limited after repeated failures', async () => {
  const db = freshDb();
  seedToken(db, { tier: 'subscriber' });

  await withServer(async baseUrl => {
    for (let i = 0; i < 10; i += 1) {
      const attempt = await request(baseUrl, '/api/tokens/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: `bad-token-${i}` }),
      });
      assert.equal(attempt.res.status, 401);
    }

    const limited = await request(baseUrl, '/api/tokens/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'bad-token-limited' }),
    });
    assert.equal(limited.res.status, 429);
  });
});
