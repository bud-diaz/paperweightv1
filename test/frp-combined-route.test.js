process.env.PAPERWEIGHT_ALLOW_MISSING_ENV = 'true';
process.env.DASHBOARD_TOKEN = 'test-dashboard-token';
process.env.DOWNLOAD_SIGNING_SECRET = 'test-download-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const { freshDb } = require('./helpers');
const config = require('../src/config');
const { createApp } = require('../src/index');
const frpSupervisor = require('../src/runtime/frp-supervisor');

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

function tempRuntimeRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-combined-frp-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, '.env'), 'PAPERWEIGHT_ALLOW_MISSING_ENV=true\n', 'utf8');
  return root;
}

test('combined FRP route registers telemetry then creates and starts tunnel in one request', async t => {
  const auth = { headers: { 'X-Dashboard-Token': process.env.DASHBOARD_TOKEN, 'Content-Type': 'application/json' } };
  const originalPlatform = config.platform;
  const originalRoot = config.paths.root;
  const originalSlug = config.station.slug;
  const originalPublicUrl = config.station.publicUrl;
  const originalProvider = config.station.tunnelProvider;
  const originalFrpTunnel = config.station.frpTunnel;
  const originalFrp = config.station.frp;
  const originalTelemetryConfigured = config.telemetry.secretConfigured;
  const originalTelemetryUrl = config.telemetry.url;
  const originalSecretEnv = process.env.PAPE_TELEMETRY_SECRET;
  const root = tempRuntimeRoot(t);
  const calls = [];

  const stub = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const parsed = JSON.parse(body || '{}');
      calls.push({ method: req.method, url: req.url, headers: req.headers, body: parsed });
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/api/modules/paperweight/register') {
        assert.equal(parsed.slug, 'radio-test');
        assert.match(parsed.secret, /^[a-f0-9]{64}$/);
        return res.end(JSON.stringify({ ok: true }));
      }
      if (req.url === '/api/modules/paperweight/frp/tunnel/create') {
        assert.equal(req.headers['x-telemetry-secret'], calls[0].body.secret);
        return res.end(JSON.stringify({
          ok: true,
          provider: 'frp',
          hostname: 'radio-test.paperweighthq.com',
          serverAddr: 'tunnel.paperweighthq.com',
          serverPort: 7000,
          authToken: 'frp-token',
          proxyName: 'pw-radio-test',
          subdomain: 'radio-test',
        }));
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'not stubbed' }));
    });
  });
  await new Promise(resolve => stub.listen(0, '127.0.0.1', resolve));

  const originalStart = frpSupervisor.start;
  const started = [];
  frpSupervisor.start = configPath => started.push(configPath);

  try {
    config.platform = 'desktop';
    config.paths.root = root;
    config.station.slug = 'radio-test';
    config.station.publicUrl = '';
    config.station.tunnelProvider = '';
    config.station.frpTunnel = false;
    config.station.frp = {};
    config.telemetry.secretConfigured = false;
    config.telemetry.url = `http://127.0.0.1:${stub.address().port}`;
    delete process.env.PAPE_TELEMETRY_SECRET;

    const db = freshDb();
    db.prepare("INSERT INTO station_registry (id, slug, url) VALUES (1, 'radio-test', 'https://old.example.com')").run();

    await withServer(async baseUrl => {
      const created = await request(baseUrl, '/api/dashboard/station/frp/paperweighthq/register-and-create', { method: 'POST', headers: auth.headers });
      assert.equal(created.res.status, 200, created.text);
      assert.equal(created.body.url, 'https://radio-test.paperweighthq.com');
      assert.equal(created.body.registeredTelemetry, true);
      assert.equal(created.body.restartRequired, false);
      assert.equal(calls.map(call => call.url).join(','), '/api/modules/paperweight/register,/api/modules/paperweight/frp/tunnel/create');
      assert.equal(config.telemetry.secretConfigured, true);
      assert.match(process.env.PAPE_TELEMETRY_SECRET, /^[a-f0-9]{64}$/);
      assert.equal(config.station.publicUrl, 'https://radio-test.paperweighthq.com');
      assert.equal(config.station.tunnelProvider, 'frp');
      assert.equal(started.length, 1);
      assert.ok(fs.existsSync(path.join(root, 'tunnel', 'frpc.toml')));
      assert.match(fs.readFileSync(path.join(root, '.env'), 'utf8'), /PAPE_TELEMETRY_SECRET=[a-f0-9]{64}/);
      assert.match(fs.readFileSync(path.join(root, '.env'), 'utf8'), /FRP_TUNNEL_TOKEN=frp-token/);
    });
  } finally {
    frpSupervisor.start = originalStart;
    frpSupervisor.stop();
    stub.close();
    config.platform = originalPlatform;
    config.paths.root = originalRoot;
    config.station.slug = originalSlug;
    config.station.publicUrl = originalPublicUrl;
    config.station.tunnelProvider = originalProvider;
    config.station.frpTunnel = originalFrpTunnel;
    config.station.frp = originalFrp;
    config.telemetry.secretConfigured = originalTelemetryConfigured;
    config.telemetry.url = originalTelemetryUrl;
    if (originalSecretEnv === undefined) delete process.env.PAPE_TELEMETRY_SECRET;
    else process.env.PAPE_TELEMETRY_SECRET = originalSecretEnv;
  }
});
