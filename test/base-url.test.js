process.env.PAPERWEIGHT_ALLOW_MISSING_ENV = 'true';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');

const config = require('../src/config');
const { publicBaseUrl } = require('../src/runtime/base-url');

test('localOrigin falls back to a LAN IPv4 (not "localhost") when HOST=0.0.0.0 and no STATION_PUBLIC_URL is set', () => {
  const savedHost = config.host;
  const savedPublicUrl = config.station.publicUrl;
  try {
    config.host = '0.0.0.0';
    config.station.publicUrl = '';

    const url = new URL(publicBaseUrl());

    const hasExternalIPv4 = Object.values(os.networkInterfaces())
      .flat()
      .some(iface => iface.family === 'IPv4' && !iface.internal);

    if (hasExternalIPv4) {
      // A phone on the LAN can resolve this — 'localhost' would resolve to
      // the phone itself, which is the bug this fallback fixes.
      assert.notEqual(url.hostname, 'localhost');
    } else {
      // Sandboxed/offline test environments have no LAN adapter to fall
      // back to; the old safe default still applies.
      assert.equal(url.hostname, 'localhost');
    }
  } finally {
    config.host = savedHost;
    config.station.publicUrl = savedPublicUrl;
  }
});

test('a configured STATION_PUBLIC_URL always wins over the LAN fallback', () => {
  const savedHost = config.host;
  const savedPublicUrl = config.station.publicUrl;
  try {
    config.host = '0.0.0.0';
    config.station.publicUrl = 'https://station.example.ts.net';

    assert.equal(publicBaseUrl(), 'https://station.example.ts.net');
  } finally {
    config.host = savedHost;
    config.station.publicUrl = savedPublicUrl;
  }
});
