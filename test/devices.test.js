process.env.PAPERWEIGHT_ALLOW_MISSING_ENV = 'true';
process.env.DASHBOARD_TOKEN = 'test-dashboard-token';

const test = require('node:test');
const assert = require('node:assert/strict');

const { freshDb } = require('./helpers');
const { createApp } = require('../src/index');
const config = require('../src/config');

// csrfCheck allows this fixed origin regardless of the ephemeral test port
// (see src/runtime/base-url.js allowedStationOrigins) — the test server binds
// to an OS-assigned port, so it can't match config.port itself.
const DASHBOARD_ORIGIN = `http://127.0.0.1:${config.port}`;

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

test('a paired device can sign in via QR redeem and be revoked', async () => {
  freshDb();

  await withServer(async baseUrl => {
    const desktopCookie = await loginAsDesktop(baseUrl);

    const pair = await request(baseUrl, '/api/dashboard/devices/pair', {
      method: 'POST',
      headers: { Cookie: `pw_dashboard_session=${desktopCookie}`, Origin: DASHBOARD_ORIGIN },
    });
    assert.equal(pair.res.status, 200);
    assert.equal(typeof pair.body.pairToken, 'string');

    const redeem = await request(baseUrl, '/api/auth/dashboard/device/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pairToken: pair.body.pairToken }),
    });
    assert.equal(redeem.res.status, 200);
    const deviceCookie = cookieValue(redeem.res.headers.get('set-cookie'), 'pw_dashboard_session');
    assert.ok(deviceCookie);
    assert.notEqual(deviceCookie, desktopCookie);

    // The desktop's poll picks up the claim.
    const status = await request(baseUrl, `/api/dashboard/devices/pair/status?pt=${pair.body.pairToken}`, {
      headers: { Cookie: `pw_dashboard_session=${desktopCookie}` },
    });
    assert.equal(status.body.status, 'claimed');

    // The device's own cookie authenticates it against a requireDashboard route.
    const list = await request(baseUrl, '/api/dashboard/devices', {
      headers: { Cookie: `pw_dashboard_session=${deviceCookie}` },
    });
    assert.equal(list.res.status, 200);
    assert.equal(list.body.devices.length, 1);
    const deviceId = list.body.devices[0].id;

    // Revoking from the desktop session immediately invalidates the device's cookie.
    const revoke = await request(baseUrl, `/api/dashboard/devices/${deviceId}`, {
      method: 'DELETE',
      headers: { Cookie: `pw_dashboard_session=${desktopCookie}`, Origin: DASHBOARD_ORIGIN },
    });
    assert.equal(revoke.res.status, 200);

    const afterRevoke = await request(baseUrl, '/api/dashboard/devices', {
      headers: { Cookie: `pw_dashboard_session=${deviceCookie}` },
    });
    assert.equal(afterRevoke.res.status, 401);
  });
});

test('a pairing token cannot be redeemed twice', async () => {
  freshDb();

  await withServer(async baseUrl => {
    const desktopCookie = await loginAsDesktop(baseUrl);
    const pair = await request(baseUrl, '/api/dashboard/devices/pair', {
      method: 'POST',
      headers: { Cookie: `pw_dashboard_session=${desktopCookie}`, Origin: DASHBOARD_ORIGIN },
    });

    const redeemOptions = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pairToken: pair.body.pairToken }),
    };
    const results = await Promise.all([
      request(baseUrl, '/api/auth/dashboard/device/redeem', redeemOptions),
      request(baseUrl, '/api/auth/dashboard/device/redeem', redeemOptions),
    ]);
    const statuses = results.map(r => r.res.status).sort();
    assert.deepEqual(statuses, [200, 401]);
  });
});

test('redeeming an unknown pairing token is rejected', async () => {
  freshDb();

  await withServer(async baseUrl => {
    const redeem = await request(baseUrl, '/api/auth/dashboard/device/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pairToken: 'not-a-real-token' }),
    });
    assert.equal(redeem.res.status, 401);
    assert.equal(redeem.res.headers.get('set-cookie'), null);
  });
});
