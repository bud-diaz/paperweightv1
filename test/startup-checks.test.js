// Startup security/config warnings. Pure function over an env object.
const test = require('node:test');
const assert = require('node:assert');
const { collectStartupWarnings } = require('../src/startup-checks');

// A baseline env that produces zero warnings, so each test can introduce a
// single misconfiguration and assert on it in isolation.
function cleanEnv(overrides = {}) {
  return {
    DASHBOARD_TOKEN: 'tok',
    DOWNLOAD_SIGNING_SECRET: 'sec',
    ...overrides,
  };
}

function hasWarning(env, needle) {
  return collectStartupWarnings(env).some(w => w.includes(needle));
}

test('a fully-configured non-paid local install warns about nothing', () => {
  assert.deepStrictEqual(collectStartupWarnings(cleanEnv()), []);
});

test('missing owner/signing secrets are each flagged', () => {
  assert.ok(hasWarning({ DOWNLOAD_SIGNING_SECRET: 's' }, 'DASHBOARD_TOKEN'));
  assert.ok(hasWarning({ DASHBOARD_TOKEN: 't' }, 'DOWNLOAD_SIGNING_SECRET'));
});

test('public URL without HTTPS is flagged, but localhost and https are not', () => {
  assert.ok(hasWarning(cleanEnv({ STATION_PUBLIC_URL: 'http://radio.example.com', HTTPS: 'false' }), 'HTTPS=false'));
  assert.ok(!hasWarning(cleanEnv({ STATION_PUBLIC_URL: 'http://localhost:3000', HTTPS: 'false' }), 'HTTPS=false'));
  assert.ok(!hasWarning(cleanEnv({ STATION_PUBLIC_URL: 'https://radio.example.com', HTTPS: 'true' }), 'HTTPS=false'));
});

test('Stripe configured without a webhook secret blocks paid access', () => {
  assert.ok(hasWarning(cleanEnv({ STRIPE_SECRET_KEY: 'sk', STRIPE_PRICE_SUBSCRIBER: 'price' }), 'STRIPE_WEBHOOK_SECRET is missing'));
  // Fully configured Stripe: no webhook/price warnings.
  const full = cleanEnv({ STRIPE_SECRET_KEY: 'sk', STRIPE_WEBHOOK_SECRET: 'wh', STRIPE_PRICE_SUBSCRIBER: 'price' });
  assert.ok(!collectStartupWarnings(full).some(w => w.includes('Stripe')));
});

test('partial Stripe config (no secret key) disables Stripe', () => {
  assert.ok(hasWarning(cleanEnv({ STRIPE_WEBHOOK_SECRET: 'wh' }), 'Stripe is partially configured'));
});

test('PayPal configured without a webhook id is flagged; complete config is silent', () => {
  assert.ok(hasWarning(cleanEnv({ PAYPAL_CLIENT_ID: 'id', PAYPAL_CLIENT_SECRET: 'sec' }), 'PAYPAL_WEBHOOK_ID is missing'));
  assert.ok(hasWarning(cleanEnv({ PAYPAL_CLIENT_ID: 'id' }), 'PayPal is partially configured'));
  const full = cleanEnv({ PAYPAL_CLIENT_ID: 'id', PAYPAL_CLIENT_SECRET: 'sec', PAYPAL_WEBHOOK_ID: 'wh' });
  assert.ok(!collectStartupWarnings(full).some(w => w.includes('PayPal')));
});
