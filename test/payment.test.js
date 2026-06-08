// Core subscription state transitions used by the Stripe and PayPal webhooks.
const test = require('node:test');
const assert = require('node:assert');
const { freshDb, seedListener, seedToken, futureIso } = require('./helpers');
const {
  activateSubscription,
  cancelSubscription,
  claimAndRun,
  isPaidCheckoutSession,
  isSucceededPaymentIntent,
  refreshExistingStripeSubscription,
} = require('../src/api/payment');
const { createVaultUnlock, resolvePaidUnlockSession } = require('../src/api/vault');

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

test('paid vault unlocks require a Stripe payment id, while free one-time unlocks can be local', () => {
  const db = freshDb();
  const listenerId = seedListener(db);

  assert.throws(() => {
    createVaultUnlock(db, {
      listenerId,
      unlockType: 'track',
      targetId: 123,
      paymentType: 'one_time',
      amountPaid: 500,
      stripePaymentId: null,
      expiresAt: null,
    });
  }, /Stripe payment or subscription id/);

  const id = createVaultUnlock(db, {
    listenerId,
    unlockType: 'track',
    targetId: 123,
    paymentType: 'one_time',
    amountPaid: 0,
    stripePaymentId: null,
    expiresAt: null,
  });

  const row = db.prepare('SELECT * FROM vault_unlocks WHERE id = ?').get(id);
  assert.strictEqual(row.amount_paid, 0);
  assert.strictEqual(row.stripe_payment_id, null);
});

test('vault redirect sessions must prove payment or an active subscription', () => {
  const baseMeta = {
    vault_unlock_type: 'track',
    vault_listener_id: '1',
    vault_target_id: '9',
  };

  assert.strictEqual(resolvePaidUnlockSession({
    metadata: { ...baseMeta, vault_payment_type: 'one_time' },
    payment_status: 'unpaid',
    payment_intent: { id: 'pi_unpaid', status: 'requires_payment_method' },
  }), null);

  assert.deepStrictEqual(resolvePaidUnlockSession({
    metadata: { ...baseMeta, vault_payment_type: 'one_time' },
    payment_status: 'paid',
    payment_intent: { id: 'pi_paid', status: 'succeeded' },
  }), { stripePaymentId: 'pi_paid', expiresAt: null });

  assert.strictEqual(resolvePaidUnlockSession({
    metadata: { ...baseMeta, vault_payment_type: 'recurring' },
    subscription: { id: 'sub_incomplete', status: 'incomplete', current_period_end: 2000 },
  }), null);

  assert.deepStrictEqual(resolvePaidUnlockSession({
    metadata: { ...baseMeta, vault_payment_type: 'recurring' },
    subscription: { id: 'sub_active', status: 'active', current_period_end: 2000 },
  }), { stripePaymentId: 'sub_active', expiresAt: new Date(2000 * 1000).toISOString() });
});

test('Stripe subscription renewal refreshes an existing row even without metadata', () => {
  const db = freshDb();
  const listenerId = seedListener(db);
  const token = seedToken(db, { tier: 'free', listenerId });
  activateSubscription(db, {
    providerSubscriptionId: 'sub_renew',
    provider: 'stripe',
    tier: 'subscriber',
    currentPeriodEnd: futureIso(60_000),
    listenerIdOrEmail: listenerId,
  });

  const renewed = refreshExistingStripeSubscription(db, {
    id: 'sub_renew',
    status: 'active',
    current_period_end: 4_102_444_800,
    metadata: {},
  });

  assert.strictEqual(renewed, true);
  assert.strictEqual(getSub(db, 'sub_renew').current_period_end, '2100-01-01T00:00:00.000Z');
  assert.strictEqual(db.prepare('SELECT tier FROM tokens WHERE id = ?').get(token.id).tier, 'subscriber');
});

test('tip redirect helpers require paid checkout and succeeded payment intent', () => {
  assert.strictEqual(isPaidCheckoutSession({ payment_status: 'paid' }), true);
  assert.strictEqual(isPaidCheckoutSession({ payment_status: 'unpaid' }), false);
  assert.strictEqual(isSucceededPaymentIntent({ id: 'pi_1', status: 'succeeded' }), true);
  assert.strictEqual(isSucceededPaymentIntent({ id: 'pi_2', status: 'requires_payment_method' }), false);
});

test('claimAndRun runs the mutation exactly once and reports duplicates', () => {
  const db = freshDb();
  let runs = 0;
  const meta = { provider: 'stripe', eventId: 'evt_once', eventType: 'payment_intent.succeeded' };

  const first = claimAndRun(db, meta, () => { runs += 1; });
  const second = claimAndRun(db, meta, () => { runs += 1; });

  assert.strictEqual(first, 'processed');
  assert.strictEqual(second, 'duplicate', 'a re-delivery of the same event must not run the mutation');
  assert.strictEqual(runs, 1, 'mutation must execute exactly once across duplicate deliveries');
  assert.strictEqual(
    db.prepare("SELECT COUNT(*) c FROM webhook_events WHERE event_id = 'evt_once'").get().c,
    1
  );
});

test('claimAndRun rolls back the claim when the mutation throws (event stays retryable)', () => {
  const db = freshDb();
  const meta = { provider: 'stripe', eventId: 'evt_boom', eventType: 'checkout.session.completed' };

  assert.throws(() => claimAndRun(db, meta, () => { throw new Error('mutation failed'); }), /mutation failed/);
  assert.strictEqual(
    db.prepare("SELECT COUNT(*) c FROM webhook_events WHERE event_id = 'evt_boom'").get().c,
    0,
    'a failed mutation must leave no claim row, so the provider retry can reprocess'
  );

  // The retry now succeeds and is recorded.
  let ran = false;
  const retry = claimAndRun(db, meta, () => { ran = true; });
  assert.strictEqual(retry, 'processed');
  assert.strictEqual(ran, true);
});

test('a duplicate tip event cannot double-record the tip (gate + unique index)', () => {
  const db = freshDb();
  const insertTip = () => db.prepare(
    'INSERT INTO tips (amount_cents, stripe_payment_intent_id) VALUES (?, ?) ON CONFLICT DO NOTHING'
  ).run(500, 'pi_tip');

  claimAndRun(db, { provider: 'stripe', eventId: 'evt_tip', eventType: 'payment_intent.succeeded' }, insertTip);
  claimAndRun(db, { provider: 'stripe', eventId: 'evt_tip', eventType: 'payment_intent.succeeded' }, insertTip);

  const rows = db.prepare("SELECT * FROM tips WHERE stripe_payment_intent_id = 'pi_tip'").all();
  assert.strictEqual(rows.length, 1, 'tip revenue must not be double-counted on a duplicate webhook');
});

test('tips.stripe_payment_intent_id is unique (defense-in-depth backstop)', () => {
  const db = freshDb();
  db.prepare("INSERT INTO tips (amount_cents, stripe_payment_intent_id) VALUES (300, 'pi_dup')").run();
  assert.throws(() => {
    db.prepare("INSERT INTO tips (amount_cents, stripe_payment_intent_id) VALUES (300, 'pi_dup')").run();
  }, /UNIQUE/);
  // NULL payment ids are exempt (partial index) — multiple allowed.
  db.prepare("INSERT INTO tips (amount_cents, stripe_payment_intent_id) VALUES (300, NULL)").run();
  db.prepare("INSERT INTO tips (amount_cents, stripe_payment_intent_id) VALUES (300, NULL)").run();
});
