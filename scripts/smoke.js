#!/usr/bin/env node
// HTTP smoke test for a running Paperweight server or packaged executable.

const http = require('http');
const https = require('https');

const baseUrl = new URL(process.argv[2] || process.env.PAPERWEIGHT_SMOKE_URL || 'http://localhost:3000');
const timeoutMs = parseInt(process.env.PAPERWEIGHT_SMOKE_TIMEOUT_MS || '5000', 10);
let ok = true;

function request(pathname) {
  return new Promise(resolve => {
    const target = new URL(pathname, baseUrl);
    const lib = target.protocol === 'https:' ? https : http;
    const req = lib.get(target, { timeout: timeoutMs }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ status: 0, error: `timeout after ${timeoutMs}ms` });
    });
    req.on('error', err => resolve({ status: 0, error: err.message }));
  });
}

function pass(msg) {
  console.log(`OK   ${msg}`);
}

function fail(msg) {
  console.log(`FAIL ${msg}`);
  ok = false;
}

function parseJson(body) {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

async function expect(pathname, predicate, description) {
  const res = await request(pathname);
  if (predicate(res)) {
    pass(description);
  } else {
    const detail = res.error ? ` (${res.error})` : ` (HTTP ${res.status})`;
    fail(`${description}${detail}`);
  }
  return res;
}

async function main() {
  console.log(`Smoke testing ${baseUrl.href}`);

  await expect('/api/health', res => {
    const json = parseJson(res.body);
    return res.status === 200 && json?.status === 'ok';
  }, 'health endpoint returns ok');

  await expect('/manifest.json', res => {
    const json = parseJson(res.body);
    return res.status === 200 && json?.name;
  }, 'manifest endpoint returns station metadata');

  await expect('/api/stream/status', res => {
    const json = parseJson(res.body);
    return res.status === 200 && typeof json?.liveActive === 'boolean';
  }, 'stream status includes liveActive field');

  await expect('/api/dashboard/vault', res => res.status === 401, 'dashboard API rejects missing dashboard token');

  await expect('/api/library/structure', res => {
    const json = parseJson(res.body);
    return res.status === 200 && Array.isArray(json?.projects) && Array.isArray(json?.standalone);
  }, 'library structure endpoint returns arrays');

  await expect('/', res => res.status === 200 && /html/i.test(res.headers['content-type'] || ''), 'SPA fallback returns HTML');

  // Vendored frontend assets must be served locally (no runtime CDN dependency).
  await expect('/vendor/hls.min.js', res => res.status === 200 && /javascript/i.test(res.headers['content-type'] || ''), 'hls.js is served locally');
  await expect('/vendor/matter.min.js', res => res.status === 200 && /javascript/i.test(res.headers['content-type'] || ''), 'matter.js is served locally');
  await expect('/vendor/fonts/fonts.css', res => res.status === 200 && /css/i.test(res.headers['content-type'] || ''), 'fonts are served locally');

  if (!ok) {
    process.exitCode = 1;
    console.log('Smoke test failed.');
  } else {
    console.log('Smoke test passed.');
  }
}

main().catch(err => {
  console.error(`Smoke test crashed: ${err.stack || err.message}`);
  process.exit(1);
});
