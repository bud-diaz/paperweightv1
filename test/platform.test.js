// Verifies the desktop/web feature-gating flag (src/auth/platform.js) and that
// it defaults to 'web' (additive/opt-in) unless DEPLOYMENT_PLATFORM=desktop or
// PAPERWEIGHT_ELECTRON=true is set. config.js and platform.js both read their
// env vars once at module-load time, so each case below clears the require
// cache for just those two modules and re-requires with different env vars —
// cheaper than spawning a child process per case.
process.env.PAPERWEIGHT_ALLOW_MISSING_ENV = 'true';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const configPath = require.resolve('../src/config');
const platformPath = require.resolve('../src/auth/platform');

function loadPlatform(envOverrides) {
  delete require.cache[configPath];
  delete require.cache[platformPath];

  const saved = {};
  for (const key of ['DEPLOYMENT_PLATFORM', 'PAPERWEIGHT_ELECTRON']) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  Object.assign(process.env, envOverrides);

  try {
    return require('../src/auth/platform');
  } finally {
    for (const key of ['DEPLOYMENT_PLATFORM', 'PAPERWEIGHT_ELECTRON']) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

function fakeRes() {
  const res = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  return res;
}

test('defaults to web platform when no env var is set', () => {
  const { isDesktop, requireDesktop } = loadPlatform({});
  assert.equal(isDesktop(), false);

  const res = fakeRes();
  let nextCalled = false;
  requireDesktop({}, res, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
});

test('DEPLOYMENT_PLATFORM=desktop enables desktop-only routes', () => {
  const { isDesktop, requireDesktop } = loadPlatform({ DEPLOYMENT_PLATFORM: 'desktop' });
  assert.equal(isDesktop(), true);

  const res = fakeRes();
  let nextCalled = false;
  requireDesktop({}, res, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, null);
});

test('PAPERWEIGHT_ELECTRON=true implies desktop platform regardless of DEPLOYMENT_PLATFORM', () => {
  const { isDesktop } = loadPlatform({ PAPERWEIGHT_ELECTRON: 'true' });
  assert.equal(isDesktop(), true);
});

test.after(() => {
  // Leave a clean config module cached for any test that might run after this
  // file in the same process (node --test isolates files into processes, but
  // be defensive).
  delete require.cache[configPath];
  delete require.cache[platformPath];
  require('../src/config');
});
