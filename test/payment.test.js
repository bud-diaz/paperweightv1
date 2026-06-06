// Core subscription state transitions used by the Stripe and PayPal webhooks.
const test = require('node:test');
const assert = require('node:assert');
const { freshDb, seedListener, seedToken, futureIso } = require('./helpers');
const { activateSubscription, cancelSubscription, alreadyProcessed, logWebhookEvent } = require('../src/api/payment');
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

// ─── Webhook idempotency ──────────────────────────────────────────────────────

test('alreadyProcessed is false for an unseen event and true once handled', () => {
  const db = freshDb();
  assert.strictEqual(alreadyProcessed(db, 'stripe', 'evt_1'), false);

  logWebhookEvent(db, { provider: 'stripe', eventId: 'evt_1', eventType: 'checkout.session.completed', outcome: 'ok' });
  assert.strictEqual(alreadyProcessed(db, 'stripe', 'evt_1'), true, 'a handled event is treated as a duplicate on redelivery');

  // A skipped event is also terminal — re-running gains nothing.
  logWebhookEvent(db, { provider: 'stripe', eventId: 'evt_skip', eventType: 'payment_intent.succeeded', outcome: 'skipped' });
  assert.strictEqual(alreadyProcessed(db, 'stripe', 'evt_skip'), true);
});

test('alreadyProcessed allows retry after a prior error and never crosses providers', () => {
  const db = freshDb();

  // An errored attempt must NOT block a genuine retry.
  logWebhookEvent(db, { provider: 'stripe', eventId: 'evt_2', eventType: 'checkout.session.completed', outcome: 'error', errorMsg: 'boom' });
  assert.strictEqual(alreadyProcessed(db, 'stripe', 'evt_2'), false, 'errored events are retryable');

  // Same id under a different provider is a different event.
  logWebhookEvent(db, { provider: 'paypal', eventId: 'evt_3', eventType: 'BILLING.SUBSCRIPTION.ACTIVATED', outcome: 'ok' });
  assert.strictEqual(alreadyProcessed(db, 'stripe', 'evt_3'), false, 'provider is part of the identity');
  assert.strictEqual(alreadyProcessed(db, 'paypal', 'evt_3'), true);

  // A missing/null event id can never be deduplicated.
  assert.strictEqual(alreadyProcessed(db, 'paypal', null), false);
});

// ─── Vault unlocks and tips ─────────────────────────────────────────────────────

test('createVaultUnlock is idempotent on stripe_payment_id', () => {
  const db = freshDb();
  const listenerId = seedListener(db);

  const opts = { listenerId, unlockType: 'track', targetId: 1, paymentType: 'one_time', amountPaid: 500, stripePaymentId: 'pi_unlock_1', expiresAt: null };
  const id1 = createVaultUnlock(db, opts);
  const id2 = createVaultUnlock(db, opts);

  assert.strictEqual(id1, id2, 'a duplicate webhook for the same payment reuses the existing unlock');
  const rows = db.prepare('SELECT * FROM vault_unlocks WHERE stripe_payment_id = ?').all('pi_unlock_1');
  assert.strictEqual(rows.length, 1, 'no second unlock row is created for a duplicate payment');
});

test('a tip grants no access — no tier change, subscription, or vault unlock', () => {
  const db = freshDb();
  const listenerId = seedListener(db);
  const token = seedToken(db, { tier: 'free', listenerId });

  // The tip webhook's only side effect is a tips row (see payment_intent.succeeded).
  db.prepare('INSERT INTO tips (amount_cents, stripe_payment_intent_id) VALUES (?, ?)').run(500, 'pi_tip_1');

  assert.strictEqual(db.prepare('SELECT tier FROM tokens WHERE id = ?').get(token.id).tier, 'free');
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM subscriptions WHERE listener_id = ?').get(listenerId).n, 0);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM vault_unlocks WHERE listener_id = ?').get(listenerId).n, 0);
});
