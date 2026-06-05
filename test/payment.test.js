// Core subscription state transitions used by the Stripe and PayPal webhooks.
const test = require('node:test');
const assert = require('node:assert');
const { freshDb, seedListener, seedToken, futureIso } = require('./helpers');
const { activateSubscription, cancelSubscription } = require('../src/api/payment');

function getSub(db, providerSubscriptionId) {
  return db.prepare('SELECT * FROM subscriptions WHERE provider_subscription_id = ?').get(providerSubscriptionId);
}

test('activateSubscription inserts a subscription and syncs the token tier', () => {
  const db = freshDb();
  const listenerId = seedListener(db);
  const token = seedToken(db, { tier: 'free', listenerId });

  const ok = activateSubscription(db, {
    providerSubscriptionId: 'sub_1',
    provider: 'stripe',
    tier: 'pro',
    currentPeriodEnd: futureIso(),
    listenerIdOrEmail: listenerId,
  });

  assert.strictEqual(ok, true);
  const sub = getSub(db, 'sub_1');
  assert.strictEqual(sub.status, 'active');
  assert.strictEqual(sub.tier, 'pro');

  const updated = db.prepare('SELECT tier FROM tokens WHERE id = ?').get(token.id);
  assert.strictEqual(updated.tier, 'pro');
});

test('activateSubscription is an idempotent upsert on provider_subscription_id', () => {
  const db = freshDb();
  const listenerId = seedListener(db);
  seedToken(db, { tier: 'free', listenerId });

  activateSubscription(db, { providerSubscriptionId: 'sub_2', provider: 'stripe', tier: 'pro', currentPeriodEnd: futureIso(), listenerIdOrEmail: listenerId });
  activateSubscription(db, { providerSubscriptionId: 'sub_2', provider: 'stripe', tier: 'all_access', currentPeriodEnd: futureIso(), listenerIdOrEmail: listenerId });

  const rows = db.prepare('SELECT * FROM subscriptions WHERE provider_subscription_id = ?').all('sub_2');
  assert.strictEqual(rows.length, 1, 'duplicate activation must not create a second row');
  assert.strictEqual(rows[0].tier, 'all_access', 'second activation updates the existing row');
});

test('activateSubscription resolves a listener by email, and rejects unknown emails', () => {
  const db = freshDb();
  const listenerId = seedListener(db, 'known@example.com');
  seedToken(db, { tier: 'free', listenerId });

  const ok = activateSubscription(db, {
    providerSubscriptionId: 'sub_3', provider: 'stripe', tier: 'pro',
    currentPeriodEnd: futureIso(), listenerIdOrEmail: 'known@example.com',
  });
  assert.strictEqual(ok, true);
  assert.ok(getSub(db, 'sub_3'));

  const miss = activateSubscription(db, {
    providerSubscriptionId: 'sub_4', provider: 'stripe', tier: 'pro',
    currentPeriodEnd: futureIso(), listenerIdOrEmail: 'nobody@example.com',
  });
  assert.strictEqual(miss, false);
  assert.strictEqual(getSub(db, 'sub_4'), undefined, 'no subscription row for an unknown email');
});

test('cancelSubscription expires the subscription and downgrades the token to free', () => {
  const db = freshDb();
  const listenerId = seedListener(db);
  const token = seedToken(db, { tier: 'free', listenerId });

  activateSubscription(db, { providerSubscriptionId: 'sub_5', provider: 'stripe', tier: 'all_access', currentPeriodEnd: futureIso(), listenerIdOrEmail: listenerId });
  assert.strictEqual(db.prepare('SELECT tier FROM tokens WHERE id = ?').get(token.id).tier, 'all_access');

  const ok = cancelSubscription(db, { providerSubscriptionId: 'sub_5' });
  assert.strictEqual(ok, true);
  assert.strictEqual(getSub(db, 'sub_5').status, 'expired');
  assert.strictEqual(db.prepare('SELECT tier FROM tokens WHERE id = ?').get(token.id).tier, 'free');
});

test('cancelSubscription returns false for an unknown subscription id', () => {
  const db = freshDb();
  assert.strictEqual(cancelSubscription(db, { providerSubscriptionId: 'does_not_exist' }), false);
});
