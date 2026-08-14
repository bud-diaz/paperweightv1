process.env.PAPERWEIGHT_ALLOW_MISSING_ENV = 'true';
process.env.DASHBOARD_TOKEN = 'test-dashboard-token';
process.env.DOWNLOAD_SIGNING_SECRET = 'test-download-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const { freshDb } = require('./helpers');
const config = require('../src/config');

const CORE_PAYLOAD_KEYS = [
  'stationKey', 'slug', 'name', 'publicUrl', 'searchable', 'version', 'platform',
  'listeners', 'uniqueListenersToday', 'totalTokens', 'subscribers', 'pro',
  'allAccess', 'totalTracks', 'vaultTracks', 'broadcasting', 'currentTrack',
  'grossCents',
];

test('telemetry payload matches the System.Pape station ingest contract', async () => {
  freshDb();
  const { setSetting } = require('../src/db/settings');
  const reporterPath = require.resolve('../src/telemetry/reporter');
  const originalReporter = require.cache[reporterPath];
  const originalSlug = config.station.slug;
  const originalName = config.station.name;
  const originalPublicUrl = config.station.publicUrl;

  try {
    config.station.slug = 'contract-radio';
    config.station.name = 'Contract Radio';
    config.station.publicUrl = '';
    setSetting('station_searchable', '1');
    delete require.cache[reporterPath];
    const { _private } = require('../src/telemetry/reporter');

    const payload = await _private.buildPayload();

    for (const key of CORE_PAYLOAD_KEYS) assert.ok(Object.hasOwn(payload, key), `missing ${key}`);
    assert.equal(payload.stationKey, 'contract-radio');
    assert.equal(payload.slug, 'contract-radio');
    assert.equal(payload.name, 'Contract Radio');
    assert.equal(payload.publicUrl, 'https://contract-radio.paperweighthq.com');
    assert.equal(payload.searchable, true);
    assert.equal(typeof payload.version, 'string');
    assert.equal(payload.platform, process.platform);
    assert.equal(typeof payload.listeners, 'number');
    assert.equal(typeof payload.uniqueListenersToday, 'number');
    assert.equal(typeof payload.totalTokens, 'number');
    assert.equal(typeof payload.grossCents, 'number');

    // Forward-compatible field currently sent by Paperweight v1 and documented
    // as ignored by System.Pape until activation-funnel analytics are designed.
    assert.ok(Array.isArray(payload.funnelMilestones));
  } finally {
    config.station.slug = originalSlug;
    config.station.name = originalName;
    config.station.publicUrl = originalPublicUrl;
    delete require.cache[reporterPath];
    if (originalReporter) require.cache[reporterPath] = originalReporter;
  }
});

test('telemetry payload reads searchability on every build', async () => {
  freshDb();
  const { setSetting } = require('../src/db/settings');
  const { _private } = require('../src/telemetry/reporter');

  setSetting('station_searchable', '1');
  assert.equal((await _private.buildPayload()).searchable, true);
  setSetting('station_searchable', '0');
  assert.equal((await _private.buildPayload()).searchable, false);
});

test('stationKey precedence is STATION_KEY, then slug, then install key', () => {
  freshDb();
  const reporterPath = require.resolve('../src/telemetry/reporter');
  const originalReporter = require.cache[reporterPath];
  const originalSlug = config.station.slug;
  const originalStationKey = process.env.STATION_KEY;

  function reload() {
    delete require.cache[reporterPath];
    return require('../src/telemetry/reporter')._private.getStationKey();
  }

  try {
    process.env.STATION_KEY = 'explicit-key';
    config.station.slug = 'slug-key';
    assert.equal(reload(), 'explicit-key');

    delete process.env.STATION_KEY;
    config.station.slug = 'slug-key';
    assert.equal(reload(), 'slug-key');

    config.station.slug = '';
    const generated = reload();
    assert.match(generated, /^pwinst_[a-f0-9]{32}$/);
  } finally {
    config.station.slug = originalSlug;
    if (originalStationKey === undefined) delete process.env.STATION_KEY;
    else process.env.STATION_KEY = originalStationKey;
    delete require.cache[reporterPath];
    if (originalReporter) require.cache[reporterPath] = originalReporter;
  }
});

test('integration docs preserve project vs collection terminology boundary', () => {
  const contract = fs.readFileSync('docs/system-pape-contract.md', 'utf8');
  assert.match(contract, /System\.Pape project/);
  assert.match(contract, /Paperweight collection/);
  assert.match(contract, /vault_projects/);
});
