process.env.PAPERWEIGHT_ALLOW_MISSING_ENV = 'true';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const cf = require('../src/runtime/cloudflare');

// Minimal in-process stand-in for api.cloudflare.com, so tests never hit the
// real network. `handler(req, res)` decides the response per test.
//
// baseUrl includes a `/client/v4`-style path prefix, mirroring
// DEFAULT_BASE_URL's shape — this is what catches request() dropping that
// prefix when resolving each call's path against the base.
function startFakeApi(handler) {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => handler(req, res, body ? JSON.parse(body) : null));
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}/client/v4` }));
  });
}

test('isCloudflareApiConfigured checks for a non-empty token', () => {
  assert.equal(cf.isCloudflareApiConfigured(''), false);
  assert.equal(cf.isCloudflareApiConfigured('   '), false);
  assert.equal(cf.isCloudflareApiConfigured(undefined), false);
  assert.equal(cf.isCloudflareApiConfigured('a-token'), true);
});

test('verifyToken resolves ok:true on a successful Cloudflare response', async () => {
  const { server, baseUrl } = await startFakeApi((req, res) => {
    assert.equal(req.headers.authorization, 'Bearer good-token');
    assert.equal(req.url, '/client/v4/user/tokens/verify');
    res.end(JSON.stringify({ success: true, result: { status: 'active' } }));
  });
  try {
    const out = await cf.verifyToken('good-token', baseUrl);
    assert.equal(out.ok, true);
    assert.equal(out.result.status, 'active');
  } finally {
    server.close();
  }
});

test('verifyToken surfaces Cloudflare\'s error message on an invalid token', async () => {
  const { server, baseUrl } = await startFakeApi((req, res) => {
    res.statusCode = 401;
    res.end(JSON.stringify({ success: false, errors: [{ code: 1000, message: 'Invalid API Token' }] }));
  });
  try {
    const out = await cf.verifyToken('bad-token', baseUrl);
    assert.equal(out.ok, false);
    assert.equal(out.error, 'Invalid API Token');
  } finally {
    server.close();
  }
});

test('an unreachable Cloudflare API resolves ok:false instead of throwing', async () => {
  // Nothing listening on this port — connection is refused immediately,
  // exercising the same failure path a real timeout would (fail closed,
  // no exception escapes the module boundary) without waiting out the full
  // request timeout in the test suite.
  const out = await cf.listAccounts('any-token', 'http://127.0.0.1:1');
  assert.equal(out.ok, false);
  assert.match(out.error, /failed/i);
});

test('createTunnel posts a name and secret, returning the created tunnel', async () => {
  const { server, baseUrl } = await startFakeApi((req, res, body) => {
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/client/v4/accounts/acct123/cfd_tunnel');
    assert.equal(body.name, 'paperweight');
    assert.ok(body.tunnel_secret);
    res.end(JSON.stringify({ success: true, result: { id: 'tunnel-abc' } }));
  });
  try {
    const out = await cf.createTunnel('tok', 'acct123', 'paperweight', baseUrl);
    assert.equal(out.ok, true);
    assert.equal(out.result.id, 'tunnel-abc');
  } finally {
    server.close();
  }
});

test('getTunnelToken fetches the connector token for a tunnel', async () => {
  const { server, baseUrl } = await startFakeApi((req, res) => {
    assert.equal(req.url, '/client/v4/accounts/acct123/cfd_tunnel/tunnel-abc/token');
    res.end(JSON.stringify({ success: true, result: 'connector-token-value' }));
  });
  try {
    const out = await cf.getTunnelToken('tok', 'acct123', 'tunnel-abc', baseUrl);
    assert.equal(out.ok, true);
    assert.equal(out.result, 'connector-token-value');
  } finally {
    server.close();
  }
});

test('createDnsRoute configures ingress then creates the CNAME', async () => {
  const calls = [];
  const { server, baseUrl } = await startFakeApi((req, res, body) => {
    calls.push({ method: req.method, url: req.url, body });
    if (req.method === 'PUT') {
      res.end(JSON.stringify({ success: true, result: {} }));
    } else {
      res.end(JSON.stringify({ success: true, result: { id: 'dns-1' } }));
    }
  });
  try {
    const out = await cf.createDnsRoute('tok', 'acct123', 'tunnel-abc', 'zone1', 'radio.example.com', 3000, baseUrl);
    assert.equal(out.ok, true);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, '/client/v4/accounts/acct123/cfd_tunnel/tunnel-abc/configurations');
    assert.equal(calls[0].body.config.ingress[0].hostname, 'radio.example.com');
    assert.equal(calls[0].body.config.ingress[0].service, 'http://localhost:3000');
    assert.equal(calls[1].url, '/client/v4/zones/zone1/dns_records');
    assert.equal(calls[1].body.content, 'tunnel-abc.cfargotunnel.com');
  } finally {
    server.close();
  }
});

test('createDnsRoute stops and surfaces the error if the ingress config call fails', async () => {
  const calls = [];
  const { server, baseUrl } = await startFakeApi((req, res) => {
    calls.push(req.method);
    res.statusCode = 400;
    res.end(JSON.stringify({ success: false, errors: [{ message: 'Invalid ingress config' }] }));
  });
  try {
    const out = await cf.createDnsRoute('tok', 'acct123', 'tunnel-abc', 'zone1', 'radio.example.com', 3000, baseUrl);
    assert.equal(out.ok, false);
    assert.equal(out.error, 'Invalid ingress config');
    assert.deepEqual(calls, ['PUT']);
  } finally {
    server.close();
  }
});

test('pauseIngress replaces ingress with a single 503 catch-all', async () => {
  const calls = [];
  const { server, baseUrl } = await startFakeApi((req, res, body) => {
    calls.push({ method: req.method, url: req.url, body });
    res.end(JSON.stringify({ success: true, result: {} }));
  });
  try {
    const out = await cf.pauseIngress('tok', 'acct123', 'tunnel-abc', baseUrl);
    assert.equal(out.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'PUT');
    assert.equal(calls[0].url, '/client/v4/accounts/acct123/cfd_tunnel/tunnel-abc/configurations');
    assert.deepEqual(calls[0].body.config.ingress, [{ service: 'http_status:503' }]);
  } finally {
    server.close();
  }
});

test('resumeIngress restores the working hostname ingress', async () => {
  const calls = [];
  const { server, baseUrl } = await startFakeApi((req, res, body) => {
    calls.push({ method: req.method, url: req.url, body });
    res.end(JSON.stringify({ success: true, result: {} }));
  });
  try {
    const out = await cf.resumeIngress('tok', 'acct123', 'tunnel-abc', 'radio.example.com', 3000, baseUrl);
    assert.equal(out.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/client/v4/accounts/acct123/cfd_tunnel/tunnel-abc/configurations');
    assert.equal(calls[0].body.config.ingress[0].hostname, 'radio.example.com');
    assert.equal(calls[0].body.config.ingress[0].service, 'http://localhost:3000');
    assert.equal(calls[0].body.config.ingress[1].service, 'http_status:404');
  } finally {
    server.close();
  }
});
