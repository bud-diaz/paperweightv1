#!/usr/bin/env node
// Basic external reachability monitor for Station Ops subscribers.
//
// Intentionally lightweight for the waitlist-test phase (see
// docs/STATION_OPS_MODEL.md) — a script the founder runs by hand or via cron,
// not a hosted monitoring dashboard. Reuses the same SSRF-safe URL-checking
// pattern already used for the in-app station health check
// (src/runtime/net-guard.js, src/api/dashboard.js's pingUrl).
//
// Usage:
//   node scripts/station-ops-monitor.js https://radio.example.com https://another.example.com
//   node scripts/station-ops-monitor.js --file data/station-ops-subscribers.txt
//
// The --file option expects one station URL per line (blank lines and lines
// starting with # are ignored). Exits non-zero if any station is unreachable,
// so this can be wired into cron + an alerting tool later without changes.

'use strict';

const fs = require('fs');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const { resolveSafeAddress } = require('../src/runtime/net-guard');

const TIMEOUT_MS = 5000;

function readUrlsFromFile(filePath) {
  return fs.readFileSync(filePath, 'utf8')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
}

async function checkStation(baseUrl) {
  const start = Date.now();
  let parsed;
  try {
    parsed = new URL('/api/health', baseUrl);
  } catch {
    return { url: baseUrl, reachable: false, latencyMs: 0, error: 'Invalid URL' };
  }

  const safeAddress = await resolveSafeAddress(parsed.hostname);
  if (!safeAddress) {
    return { url: baseUrl, reachable: false, latencyMs: Date.now() - start, error: 'URL resolves to a private or reserved address' };
  }

  return new Promise(resolve => {
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.get(parsed.href, {
      timeout: TIMEOUT_MS,
      lookup: (_hostname, _options, cb) => cb(null, safeAddress.address, safeAddress.family),
    }, res => {
      res.resume();
      resolve({
        url: baseUrl,
        reachable: res.statusCode >= 200 && res.statusCode < 500,
        latencyMs: Date.now() - start,
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ url: baseUrl, reachable: false, latencyMs: TIMEOUT_MS, error: 'Timeout' }); });
    req.on('error',   err => resolve({ url: baseUrl, reachable: false, latencyMs: Date.now() - start, error: err.message }));
  });
}

async function main() {
  const args = process.argv.slice(2);
  const fileIndex = args.indexOf('--file');
  const urls = fileIndex !== -1
    ? readUrlsFromFile(args[fileIndex + 1])
    : args.filter(a => !a.startsWith('--'));

  if (!urls.length) {
    console.error('Usage: node scripts/station-ops-monitor.js <url> [<url>...]');
    console.error('   or: node scripts/station-ops-monitor.js --file <path>');
    process.exit(1);
  }

  const results = await Promise.all(urls.map(checkStation));

  let anyDown = false;
  for (const result of results) {
    if (result.reachable) {
      console.log(`OK   ${result.url} (${result.latencyMs}ms)`);
    } else {
      anyDown = true;
      console.log(`DOWN ${result.url} — ${result.error || 'unreachable'} (${result.latencyMs}ms)`);
    }
  }

  if (anyDown) process.exitCode = 1;
}

main().catch(err => {
  console.error(`Station Ops monitor failed: ${err.message}`);
  process.exit(1);
});
