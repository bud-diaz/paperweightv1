// Core subscription state transitions used by the Stripe and PayPal webhooks.
const test = require('node:test');
const assert = require('node:assert');
const { freshDb, seedListener, seedToken, futureIso } = require('./helpers');
const { activateSubscription, cancelSubscription } = require('../src/api/payment');
const { createVaultUnlock } = require('../src/api/vault');

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

test('webhook event ids are unique per provider', () => {
  const db = freshDb();
  db.prepare(
    "INSERT INTO webhook_events (provider, event_id, event_type, outcome) VALUES ('stripe', 'evt_1', 'checkout.session.completed', 'ok')"
  ).run();

  assert.throws(() => {
    db.prepare(
      "INSERT INTO webhook_events (provider, event_id, event_type, outcome) VALUES ('stripe', 'evt_1', 'checkout.session.completed', 'ok')"
    ).run();
  }, /UNIQUE/);

  db.prepare(
    "INSERT INTO webhook_events (provider, event_id, event_type, outcome) VALUES ('paypal', 'evt_1', 'BILLING.SUBSCRIPTION.ACTIVATED', 'ok')"
  ).run();
});

test('vault unlock creation is idempotent by Stripe payment id', () => {
  const db = freshDb();
  const listenerId = seedListener(db);

  const first = createVaultUnlock(db, {
    listenerId,
    unlockType: 'all_access',
    targetId: null,
    paymentType: 'one_time',
    amountPaid: 500,
    stripePaymentId: 'pi_1',
    expiresAt: null,
  });
  const second = createVaultUnlock(db, {
    listenerId,
    unlockType: 'all_access',
    targetId: null,
    paymentType: 'one_time',
    amountPaid: 500,
    stripePaymentId: 'pi_1',
    expiresAt: null,
  });

  assert.strictEqual(second, first);
  const rows = db.prepare('SELECT * FROM vault_unlocks WHERE stripe_payment_id = ?').all('pi_1');
  assert.strictEqual(rows.length, 1);
});
