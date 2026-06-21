process.env.PAPERWEIGHT_ALLOW_MISSING_ENV = 'true';

const test = require('node:test');
const assert = require('node:assert/strict');

const { computeFingerprint, getStableIdSource } = require('../src/device-lock');

test('computeFingerprint returns a stable 64-char hex sha256 digest', () => {
  const a = computeFingerprint();
  const b = computeFingerprint();
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
});

test('getStableIdSource reports a known method', () => {
  const source = getStableIdSource();
  assert.ok(['linux-machine-id', 'macos-ioreg', 'windows-registry', 'fallback'].includes(source));
});
