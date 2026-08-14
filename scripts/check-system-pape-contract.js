#!/usr/bin/env node
'use strict';

const DEFAULT_HOSTED = 'https://system.paperweighthq.com';
const args = process.argv.slice(2);
const allowHosted = args.includes('--hosted');
const allowWrite = args.includes('--write');
const base = (process.env.PAPE_URL || (allowHosted ? DEFAULT_HOSTED : '')).replace(/\/$/, '');

function fail(message) {
  console.error(`System.Pape contract check failed: ${message}`);
  process.exitCode = 1;
}

async function getJson(path) {
  const res = await fetch(`${base}${path}`);
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch {}
  return { status: res.status, body, text };
}

(async () => {
  if (!base) {
    fail('set PAPE_URL for local/staging checks, or pass --hosted to probe https://system.paperweighthq.com read-only endpoints.');
    return;
  }

  console.log(`Checking System.Pape compatibility at ${base}`);
  const checks = [];

  const health = await getJson('/api/health').catch(err => ({ error: err }));
  checks.push(['health', health]);
  if (health.error || health.status >= 500) fail(`/api/health unavailable (${health.error?.message || health.status})`);

  const slug = await getJson('/api/modules/paperweight/slugs/validate?slug=contract-test').catch(err => ({ error: err }));
  checks.push(['slug validate', slug]);
  if (slug.error || slug.status !== 200 || typeof slug.body?.valid !== 'boolean') fail('slug validation response is not compatible');

  const stations = await getJson('/api/modules/paperweight/stations?q=contract-test&limit=1').catch(err => ({ error: err }));
  checks.push(['station search', stations]);
  if (stations.error || stations.status !== 200 || !Array.isArray(stations.body?.stations)) fail('station search response is not compatible');

  const directory = await getJson('/api/modules/paperweight/directory').catch(err => ({ error: err }));
  checks.push(['directory', directory]);
  if (directory.error || directory.status !== 200 || !Array.isArray(directory.body)) fail('directory response is not compatible');

  if (allowWrite) {
    const secret = process.env.PAPE_TELEMETRY_SECRET;
    if (!secret) {
      fail('--write requires PAPE_TELEMETRY_SECRET; refusing to send ingest without it.');
    } else if (base === DEFAULT_HOSTED && !args.includes('--hosted-write-ok')) {
      fail('refusing write probe against hosted production without --hosted-write-ok.');
    } else {
      const payload = {
        stationKey: `contract-probe-${Date.now()}`,
        slug: null,
        name: 'Contract Probe',
        publicUrl: null,
        searchable: false,
        version: 'contract-probe',
        platform: process.platform,
        listeners: 0,
        uniqueListenersToday: 0,
        totalTokens: 0,
        subscribers: 0,
        pro: 0,
        allAccess: 0,
        totalTracks: 0,
        vaultTracks: 0,
        broadcasting: false,
        currentTrack: null,
        grossCents: 0,
      };
      const res = await fetch(`${base}/api/modules/paperweight/ingest`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-telemetry-secret': secret },
        body: JSON.stringify(payload),
      });
      if (![200, 401].includes(res.status)) fail(`write probe returned unexpected status ${res.status}`);
      checks.push(['ingest write probe', { status: res.status, body: res.status === 200 ? { ok: true } : { ok: false, redacted: true } }]);
    }
  }

  for (const [name, result] of checks) {
    if (result.error) console.log(`- ${name}: ERROR ${result.error.message}`);
    else console.log(`- ${name}: HTTP ${result.status}`);
  }

  if (!process.exitCode) console.log('System.Pape contract check passed.');
})().catch(err => fail(err.message));
