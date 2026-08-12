process.env.PAPERWEIGHT_ALLOW_MISSING_ENV = 'true';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildFrpcToml, writeFrpcConfig } = require('../src/runtime/frp-config');

test('buildFrpcToml writes expected subdomain proxy config', () => {
  const toml = buildFrpcToml({
    serverAddr: 'tunnel.paperweighthq.com',
    serverPort: 7000,
    authToken: 'secret-token',
    proxyName: 'pw-bud-a1b2c3',
    subdomain: 'bud',
    localPort: 3000,
  });
  assert.match(toml, /serverAddr = "tunnel\.paperweighthq\.com"/);
  assert.match(toml, /serverPort = 7000/);
  assert.match(toml, /auth\.token = "secret-token"/);
  assert.match(toml, /subdomain = "bud"/);
  assert.match(toml, /localPort = 3000/);
});

test('buildFrpcToml rejects newline-bearing token values', () => {
  assert.throws(() => buildFrpcToml({
    serverAddr: 'tunnel.paperweighthq.com',
    serverPort: 7000,
    authToken: 'secret\nEVIL=1',
    proxyName: 'pw-bud-a1b2c3',
    subdomain: 'bud',
    localPort: 3000,
  }), /authToken is invalid/);
});

test('writeFrpcConfig writes under runtime root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-frp-'));
  const out = writeFrpcConfig(root, {
    serverAddr: 'tunnel.paperweighthq.com',
    serverPort: 7000,
    authToken: 'secret-token',
    proxyName: 'pw-bud-a1b2c3',
    subdomain: 'bud',
    localPort: 3000,
  });
  assert.equal(path.dirname(out), path.join(root, 'tunnel'));
  assert.ok(fs.existsSync(out));
  assert.match(fs.readFileSync(out, 'utf8'), /name = "pw-bud-a1b2c3"/);
});
