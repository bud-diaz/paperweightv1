const router = require('express').Router();
const { getDb, log } = require('../db');
const config = require('../config');
const { paymentLimiter } = require('../middleware/rateLimiter');
const { cloudOnly } = require('../middleware/cloudGate');

// Lazy-loaded to avoid circular dependency at module init time
// (vault.js → router.js → payment.js, and payment.js → vault.js)
function getCreateVaultUnlock() {
  return require('./vault').createVaultUnlock;
}

const ACTIVE_STRIPE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing']);

function isStripeSubscriptionActive(sub) {
  return !!(sub && ACTIVE_STRIPE_SUBSCRIPTION_STATUSES.has(sub.status));
}

function isPaidCheckoutSession(session) {
  return session?.payment_status === 'paid';
}

function isSucceededPaymentIntent(pi) {
  return !!(pi && typeof pi !== 'string' && pi.status === 'succeeded');
}

function currentPeriodEndIso(sub) {
  if (!sub?.current_period_end) return null;
  return new Date(sub.current_period_end * 1000).toISOString();
}

function refreshExistingStripeSubscription(db, sub) {
  if (!sub?.id || !isStripeSubscriptionActive(sub)) return false;
  const existing = db.prepare(
    'SELECT id, listener_id, tier FROM subscriptions WHERE provider_subscription_id = ?'
  ).get(sub.id);
  const periodEnd = currentPeriodEndIso(sub);
  if (!existing || !periodEnd) return false;

  const tier = sub.metadata?.tier || existing.tier;
  db.prepare(
    "UPDATE subscriptions SET tier = ?, status = 'active', current_period_end = ? WHERE id = ?"
  ).run(tier, periodEnd, existing.id);
  db.prepare(
    'UPDATE tokens SET tier = ? WHERE listener_id = ? AND is_active = 1'
  ).run(tier, existing.listener_id);
  return true;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Updates the listener's token tier and upserts the subscription record.
// Called by both Stripe and PayPal webhook handlers on subscription activation.
function activateSubscription(db, { providerSubscriptionId, provider, tier, currentPeriodEnd, listenerIdOrEmail }) {
  // Resolve listener_id from email if needed
  let listenerId = listenerIdOrEmail;
  if (typeof listenerIdOrEmail === 'string' && listenerIdOrEmail.includes('@')) {
    const account = db.prepare('SELECT id FROM listener_accounts WHERE email = ?').get(listenerIdOrEmail);
    if (!account) return false;
    listenerId = account.id;
  }

  // Upsert subscription record
  const existing = db.prepare(
    'SELECT id FROM subscriptions WHERE listener_id = ? AND provider_subscription_id = ?'
  ).get(listenerId, providerSubscriptionId);

  if (existing) {
    db.prepare(
      "UPDATE subscriptions SET tier = ?, status = 'active', current_period_end = ? WHERE id = ?"
    ).run(tier, currentPeriodEnd, existing.id);
  } else {
    db.prepare(
      'INSERT INTO subscriptions (listener_id, tier, provider, provider_subscription_id, status, current_period_end) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(listenerId, tier, provider, providerSubscriptionId, 'active', currentPeriodEnd);
  }

  // Sync token tier
  db.prepare(
    'UPDATE tokens SET tier = ? WHERE listener_id = ? AND is_active = 1'
  ).run(tier, listenerId);

  return true;
}

function cancelSubscription(db, { providerSubscriptionId }) {
  const sub = db.prepare(
    'SELECT * FROM subscriptions WHERE provider_subscription_id = ?'
  ).get(providerSubscriptionId);

  if (!sub) return false;

  db.prepare(
    "UPDATE subscriptions SET status = 'expired' WHERE id = ?"
  ).run(sub.id);

  // Downgrade token to free
  db.prepare(
    "UPDATE tokens SET tier = 'free' WHERE listener_id = ? AND is_active = 1"
  ).run(sub.listener_id);

  return true;
}

// ─── Checkout ─────────────────────────────────────────────────────────────────

// POST /api/payment/checkout
// CLOUD PHASE (gated by PAPERWEIGHT_CLOUD): native-app checkout. The native
// Paperweight Play app opens the returned URL in a WebView; on success Core
// redirects to the paperweightplay:// deep link. Inert in self-hosted builds —
// the web player uses GET /checkout-url instead.
// Body: { tier: 'pro'|'all_access', provider: 'stripe'|'paypal' }
// Returns: { checkoutUrl }
router.post('/checkout', cloudOnly, paymentLimiter, (req, res) => {
  if (!req.tokenRow || !req.tokenRow.listener_id) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const { tier, provider } = req.body;
  if (!['pro', 'all_access'].includes(tier)) {
    return res.status(400).json({ error: 'tier must be pro or all_access' });
  }
  if (!['stripe', 'paypal'].includes(provider)) {
    return res.status(400).json({ error: 'provider must be stripe or paypal' });
  }

  if (provider === 'stripe') {
    return handleStripeCheckout(req, res, tier);
  }
  return handlePayPalCheckout(req, res, tier);
});

async function handleStripeCheckout(req, res, tier) {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    return res.status(503).json({ error: 'Stripe is not configured on this server' });
  }

  const priceId = tier === 'pro'
    ? process.env.STRIPE_PRICE_PRO
    : process.env.STRIPE_PRICE_ALL_ACCESS;

  if (!priceId) {
    return res.status(503).json({ error: `Stripe price ID for ${tier} is not configured` });
  }

  try {
    const stripe = require('stripe')(stripeKey);
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${config.station.publicUrl || req.headers.origin || `${req.protocol}://${req.get('host')}`}/payment/success?session_id={CHECKOUT_SESSION_ID}&tier=${tier}`,
      cancel_url: `paperweightplay://payment/cancel`,
      metadata: {
        listener_id: String(req.tokenRow.listener_id),
        tier,
      },
      subscription_data: {
        metadata: {
          listener_id: String(req.tokenRow.listener_id),
          tier,
        },
      },
    });

    res.json({ checkoutUrl: session.url });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
}

async function handlePayPalCheckout(req, res, tier) {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return res.status(503).json({ error: 'PayPal is not configured on this server' });
  }

  const planId = tier === 'pro'
    ? process.env.PAYPAL_PLAN_PRO
    : process.env.PAYPAL_PLAN_ALL_ACCESS;

  if (!planId) {
    return res.status(503).json({ error: `PayPal plan ID for ${tier} is not configured` });
  }

  try {
    // Get PayPal access token
    const tokenRes = await fetch('https://api-m.paypal.com/v1/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      body: 'grant_type=client_credentials',
    });
    const { access_token } = await tokenRes.json();

    // Create subscription
    const subRes = await fetch('https://api-m.paypal.com/v1/billing/subscriptions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${access_token}`,
      },
      body: JSON.stringify({
        plan_id: planId,
        custom_id: `${req.tokenRow.listener_id}:${tier}`,
        application_context: {
          return_url: `${config.station.publicUrl || ''}/payment/success?tier=${tier}`,
          cancel_url: 'paperweightplay://payment/cancel',
          user_action: 'SUBSCRIBE_NOW',
        },
      }),
    });

    const subscription = await subRes.json();
    const approvalLink = subscription.links?.find(l => l.rel === 'approve');

    if (!approvalLink) {
      return res.status(500).json({ error: 'Failed to get PayPal approval URL' });
    }

    res.json({ checkoutUrl: approvalLink.href });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create PayPal subscription' });
  }
}

async function getPayPalAccessToken(clientId, clientSecret) {
  const tokenRes = await fetch('https://api-m.paypal.com/v1/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: 'grant_type=client_credentials',
  });

  if (!tokenRes.ok) {
    throw new Error(`PayPal token request failed with HTTP ${tokenRes.status}`);
  }

  const data = await tokenRes.json();
  if (!data.access_token) {
    throw new Error('PayPal token response did not include access_token');
  }

  return data.access_token;
}

async function verifyPayPalWebhook({ clientId, clientSecret, webhookId, headers, event }) {
  const required = [
    'paypal-auth-algo',
    'paypal-cert-url',
    'paypal-transmission-id',
    'paypal-transmission-sig',
    'paypal-transmission-time',
  ];

  for (const header of required) {
    if (!headers[header]) {
      throw new Error(`Missing PayPal webhook header: ${header}`);
    }
  }

  const accessToken = await getPayPalAccessToken(clientId, clientSecret);
  const verifyRes = await fetch('https://api-m.paypal.com/v1/notifications/verify-webhook-signature', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      auth_algo: headers['paypal-auth-algo'],
      cert_url: headers['paypal-cert-url'],
      transmission_id: headers['paypal-transmission-id'],
      transmission_sig: headers['paypal-transmission-sig'],
      transmission_time: headers['paypal-transmission-time'],
      webhook_id: webhookId,
      webhook_event: event,
    }),
  });

  if (!verifyRes.ok) {
    throw new Error(`PayPal webhook verification failed with HTTP ${verifyRes.status}`);
  }

  const result = await verifyRes.json();
  return result.verification_status === 'SUCCESS';
}

// GET /api/payment/success
// CLOUD PHASE (gated by PAPERWEIGHT_CLOUD): redirect target for the native-app
// checkout above. Completes the subscription and redirects to the paperweightplay://
// deep link. The web player uses GET /web-success instead.
router.get('/success', cloudOnly, async (req, res) => {
  const { session_id, tier } = req.query;

  if (session_id && process.env.STRIPE_SECRET_KEY) {
    try {
      const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
      const session = await stripe.checkout.sessions.retrieve(session_id, {
        expand: ['subscription'],
      });

      const listenerId = session.metadata?.listener_id;
      const sub = session.subscription;

      if (listenerId && isStripeSubscriptionActive(sub)) {
        const db = getDb();
        activateSubscription(db, {
          providerSubscriptionId: sub.id,
          provider: 'stripe',
          tier: session.metadata.tier || tier,
          currentPeriodEnd: currentPeriodEndIso(sub),
          listenerIdOrEmail: parseInt(listenerId, 10),
        });
      }
    } catch (err) {
      // Log but don't block redirect — webhook is the authoritative sync path
    }
  }

  // Deep link back to app
  res.redirect(`paperweightplay://payment/success?tier=${tier || ''}`);
});

// GET /api/payment/status
// Returns current subscription status for the authenticated listener.
router.get('/status', (req, res) => {
  if (!req.tokenRow || !req.tokenRow.listener_id) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const db = getDb();
  const sub = db.prepare(
    "SELECT tier, provider, status, current_period_end FROM subscriptions WHERE listener_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1"
  ).get(req.tokenRow.listener_id);

  res.json({
    tier: req.tier,
    subscription: sub || null,
  });
});

// ─── Web player unlock flow ───────────────────────────────────────────────────

// GET /api/payment/checkout-url
// Public — no auth required. Returns a Stripe checkout URL for the subscriber tier.
// Used by the web player when a free listener hits a supporters_only item.
router.get('/checkout-url', paymentLimiter, async (req, res) => {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    return res.status(503).json({ error: 'Stripe not configured on this server' });
  }

  const priceId = process.env.STRIPE_PRICE_SUBSCRIBER;
  if (!priceId) {
    return res.status(503).json({ error: 'Subscriber price not configured — set STRIPE_PRICE_SUBSCRIBER in .env' });
  }

  try {
    const stripe = require('stripe')(stripeKey);
    const base = config.station.publicUrl || `http://localhost:${process.env.PORT || 3000}`;
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${base}/api/payment/web-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${base}/creator.html#library`,
    });
    res.json({ checkoutUrl: session.url });
  } catch {
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// GET /api/payment/web-success?session_id=xxx
// Stripe redirects here after a successful web checkout.
// Retrieves the session, finds or creates the listener account, issues a token,
// sets the pw_token cookie, then redirects to the library with ?subscribed=1.
router.get('/web-success', async (req, res) => {
  const { session_id } = req.query;

  if (!session_id || !process.env.STRIPE_SECRET_KEY) {
    return res.redirect('/creator.html#library');
  }

  try {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const session = await stripe.checkout.sessions.retrieve(session_id, {
      expand: ['subscription'],
    });

    const email = session.customer_details?.email || session.customer_email;
    const sub   = session.subscription;
    if (email) {
      const db = getDb();

      // INSERT OR IGNORE — idempotent if this handler runs more than once
      // (e.g. user refreshes the success page, or webhook fires concurrently)
      const ph = require('crypto').randomBytes(32).toString('hex');
      db.prepare(
        'INSERT OR IGNORE INTO listener_accounts (email, password_hash) VALUES (?, ?)'
      ).run(email, ph);
      const account = db.prepare('SELECT id FROM listener_accounts WHERE email = ?').get(email);

      // Get or create the listener's auth token
      let tokenRow = db.prepare(
        'SELECT * FROM tokens WHERE listener_id = ? AND is_active = 1 LIMIT 1'
      ).get(account.id);

      if (!tokenRow) {
        const token = require('crypto').randomBytes(32).toString('hex');
        const info = db.prepare(
          "INSERT INTO tokens (token, label, tier, listener_id) VALUES (?, ?, 'subscriber', ?)"
        ).run(token, email, account.id);
        tokenRow = db.prepare('SELECT * FROM tokens WHERE id = ?').get(info.lastInsertRowid);
      }

      // Activate the subscription immediately — do not rely solely on the webhook.
      // The webhook is still authoritative; this eliminates the race window where
      // the listener lands on the library page before the webhook arrives, and
      // attachTier finds no active subscription record → incorrectly downgrades to free.
      // session.subscription is already the expanded object (expand: ['subscription']).
      if (sub && sub.id && isStripeSubscriptionActive(sub) && currentPeriodEndIso(sub)) {
        try {
          activateSubscription(db, {
            providerSubscriptionId: sub.id,
            provider:               'stripe',
            tier:                   'subscriber',
            currentPeriodEnd:       currentPeriodEndIso(sub),
            listenerIdOrEmail:      account.id,
          });
        } catch {
          // If activation fails, the webhook will correct it.
          // Don't block the cookie set or the redirect.
        }
      }

      // Set auth cookie — httpOnly, 1-year expiry
      res.cookie('pw_token', tokenRow.token, {
        httpOnly: true,
        secure:   config.https,
        sameSite: 'lax',
        maxAge:   365 * 24 * 60 * 60 * 1000,
      });
    }
  } catch { /* log but don't block redirect — webhook is the authoritative record */ }

  res.redirect('/creator.html?subscribed=1#library');
});

// ─── Tip flow ────────────────────────────────────────────────────────────────

// GET /api/payment/tip-config
// Public — no auth. Returns creator-configured tip amounts.
// Returns { enabled: false } if Stripe is not configured.
router.get('/tip-config', (req, res) => {
  if (!process.env.STRIPE_SECRET_KEY) {
    return res.json({ enabled: false, amounts: [], customEnabled: false });
  }
  const row = getDb().prepare('SELECT amounts, custom_enabled FROM tip_config WHERE id = 1').get();
  let amounts = [300, 500, 1000];
  try { if (row) amounts = JSON.parse(row.amounts); } catch {}
  const customEnabled = row ? row.custom_enabled === 1 : true;
  res.json({ enabled: true, amounts, customEnabled });
});

// POST /api/payment/tip
// Public — no auth. Body: { amountCents: number }
// Creates a Stripe Checkout session (mode: 'payment') for a one-time tip.
// Does NOT create listener accounts, subscriptions, or change any tiers.
router.post('/tip', paymentLimiter, async (req, res) => {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return res.status(503).json({ error: 'Stripe not configured on this server' });

  const amountCents = parseInt(req.body.amountCents, 10);
  if (!amountCents || amountCents < 100) {
    return res.status(400).json({ error: 'Minimum tip is $1.00 (100 cents)' });
  }
  if (amountCents > 100000) {
    return res.status(400).json({ error: 'Amount exceeds maximum allowed tip' });
  }

  try {
    const stripe      = require('stripe')(stripeKey);
    const base        = config.station.publicUrl
      || `${req.protocol}://${req.get('host')}`;
    const stationName = config.station.name || 'the station';

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        price_data: {
          currency:     'usd',
          product_data: { name: `Support ${stationName}` },
          unit_amount:  amountCents,
        },
        quantity: 1,
      }],
      success_url:          `${base}/api/payment/tip-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:           `${base}/#player`,
      // Tag both the session and the payment intent so webhook handlers can
      // distinguish tip payments from subscription payments unambiguously.
      metadata:             { type: 'tip' },
      payment_intent_data:  { metadata: { type: 'tip', amount_cents: String(amountCents) } },
    });

    res.json({ checkoutUrl: session.url });
  } catch (err) {
    log('error', 'payment', `Tip checkout failed: ${err.message}`);
    res.status(500).json({ error: err.message || 'Failed to create tip checkout' });
  }
});

// GET /api/payment/tip-success?session_id=xxx
// Stripe redirects here after a successful tip payment.
// Logs the tip, then redirects back to the station player with ?tipped=1.
// The webhook (payment_intent.succeeded) is the authoritative record;
// this handler logs opportunistically in case the webhook is delayed.
router.get('/tip-success', async (req, res) => {
  const { session_id } = req.query;

  if (session_id && process.env.STRIPE_SECRET_KEY) {
    try {
      const stripe  = require('stripe')(process.env.STRIPE_SECRET_KEY);
      const session = await stripe.checkout.sessions.retrieve(session_id, {
        expand: ['payment_intent'],
      });

      if (session.metadata?.type === 'tip' && isPaidCheckoutSession(session) && isSucceededPaymentIntent(session.payment_intent)) {
        const pi          = session.payment_intent;
        const amountCents = pi.amount_received || pi.amount;
        const db          = getDb();

        // ON CONFLICT DO NOTHING — idempotent against idx_tips_payment_intent if the
        // webhook already logged this intent (redirect and webhook race each other).
        db.prepare(
          'INSERT INTO tips (amount_cents, stripe_payment_intent_id, stripe_checkout_session_id) VALUES (?, ?, ?) ON CONFLICT DO NOTHING'
        ).run(amountCents, pi.id, session.id);

        log('info', 'payment', `Tip logged via redirect: $${(amountCents / 100).toFixed(2)} (${pi.id})`);
      }
    } catch { /* webhook is authoritative — don't block redirect */ }
  }

  res.redirect('/creator.html?tipped=1#player');
});

// ─── Webhooks ─────────────────────────────────────────────────────────────────
// NOTE: The Stripe webhook is mounted separately in src/index.js BEFORE
// express.json() so Stripe can verify the raw request body signature.
// See module.exports.stripeWebhookHandler below.

// POST /api/payment/webhook/paypal
// PayPal sends events here. Must be registered in the PayPal developer console.
router.post('/webhook/paypal', async (req, res) => {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;

  if (!clientId || !clientSecret || !webhookId) {
    return res.status(503).json({ error: 'PayPal webhook not configured' });
  }

  const event = req.body;
  const db = getDb();
  const ppEventId   = req.headers['paypal-transmission-id'] || null;
  const ppEventType = event.event_type || 'unknown';

  // Verify the signature BEFORE touching the DB — and before the dedup read — so an
  // unauthenticated caller can't probe which transmission ids exist.
  let verified;
  try {
    verified = await verifyPayPalWebhook({
      clientId,
      clientSecret,
      webhookId,
      headers: req.headers,
      event,
    });
  } catch (err) {
    log('error', 'payment', `PayPal webhook verification error: ${err.message}`);
    return res.status(400).json({ error: 'PayPal webhook verification failed' });
  }
  if (!verified) {
    log('warn', 'payment', 'PayPal webhook signature verification failed');
    return res.status(400).json({ error: 'PayPal webhook signature verification failed' });
  }

  // Fast-path duplicate short-circuit (authoritative guard is claimAndRun).
  if (hasWebhookEvent(db, 'paypal', ppEventId)) {
    return res.json({ received: true, duplicate: true });
  }

  let outcome = 'skipped';
  let mutate = null;
  switch (event.event_type) {
    case 'BILLING.SUBSCRIPTION.ACTIVATED': {
      const sub = event.resource;
      const [listenerIdStr, tier] = (sub.custom_id || '').split(':');
      const listenerId = parseInt(listenerIdStr, 10);
      if (listenerId && tier) {
        outcome = 'ok';
        mutate = () => activateSubscription(db, {
          providerSubscriptionId: sub.id,
          provider: 'paypal',
          tier,
          currentPeriodEnd: sub.billing_info?.next_billing_time || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          listenerIdOrEmail: listenerId,
        });
      }
      break;
    }
    case 'BILLING.SUBSCRIPTION.CANCELLED':
    case 'BILLING.SUBSCRIPTION.EXPIRED': {
      const subId = event.resource.id;
      outcome = 'ok';
      mutate = () => cancelSubscription(db, { providerSubscriptionId: subId });
      break;
    }
    // default: unhandled event type — recorded as 'skipped'.
  }

  try {
    const status = claimAndRun(
      db,
      { provider: 'paypal', eventId: ppEventId, eventType: ppEventType, outcome },
      mutate
    );
    res.json({ received: true, duplicate: status === 'duplicate' });
  } catch (err) {
    log('error', 'payment', `PayPal webhook ${ppEventType} (${ppEventId}) failed: ${err.message}`);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// ─── Webhook event processing ─────────────────────────────────────────────────
// claimAndRun atomically records a webhook event and runs its state mutation in a
// SINGLE synchronous better-sqlite3 transaction. The claim is an INSERT guarded by
// the UNIQUE(provider, event_id) index (migration 010): a duplicate or concurrent
// re-delivery of the same event finds the row already present and skips the
// mutation, so subscriptions / vault unlocks / tips can never be double-applied.
// Because the transaction is synchronous and contains no awaits, two deliveries
// cannot interleave between the claim and the mutation. If `mutate` throws, the
// whole transaction (claim included) rolls back, leaving the event un-recorded so
// the provider's retry can reprocess it. Returns 'processed' | 'duplicate'.
//
// IMPORTANT: all provider API calls (awaits) must happen BEFORE this is called —
// the `mutate` closure must be purely synchronous.
function claimAndRun(db, { provider, eventId, eventType, outcome = 'ok' }, mutate) {
  let result = 'processed';
  db.transaction(() => {
    if (eventId) {
      const claim = db.prepare(
        'INSERT OR IGNORE INTO webhook_events (provider, event_id, event_type, outcome) VALUES (?, ?, ?, ?)'
      ).run(provider, eventId, eventType, outcome);
      if (claim.changes === 0) { result = 'duplicate'; return; }
    } else {
      // No stable id to dedup on (e.g. a PayPal event with no transmission id):
      // record it for the log, but it cannot be guarded against replay.
      db.prepare(
        'INSERT INTO webhook_events (provider, event_id, event_type, outcome) VALUES (?, NULL, ?, ?)'
      ).run(provider, eventType, outcome);
    }
    if (mutate) mutate();
  })();
  return result;
}

function hasWebhookEvent(db, provider, eventId) {
  if (!eventId) return false;
  return !!db.prepare(
    'SELECT id FROM webhook_events WHERE provider = ? AND event_id = ? LIMIT 1'
  ).get(provider, eventId);
}

// Exported as a standalone handler for mounting before express.json() in index.js
// so the raw body buffer is available for Stripe signature verification.
async function stripeWebhookHandler(req, res) {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    return res.status(503).json({ error: 'Stripe webhook not configured' });
  }

  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    return res.status(400).json({ error: `Webhook signature invalid: ${err.message}` });
  }

  const db = getDb();

  // Fast-path: skip the work (and the Stripe API call) for an event we have
  // already processed. The authoritative guard is the transactional claim in
  // claimAndRun below.
  if (hasWebhookEvent(db, 'stripe', event.id)) {
    return res.json({ received: true, duplicate: true });
  }

  // Resolve everything that needs a Stripe API call (await) up front, then hand a
  // purely-synchronous mutation closure to claimAndRun so the claim + mutation
  // commit or roll back together. Default is a no-op 'skipped' event.
  let outcome = 'skipped';
  let mutate = null;

  switch (event.type) {

    // Primary activation path — fires when a Stripe Checkout session completes.
    case 'checkout.session.completed': {
      const session = event.data.object;
      // Tip payments (mode:'payment', metadata.type='tip') are handled by
      // payment_intent.succeeded — skip here.
      if (session.metadata?.type === 'tip') break;

      // One-time vault unlock (mode: payment with vault metadata)
      if (session.metadata?.vault_unlock_type && session.metadata?.vault_payment_type === 'one_time') {
        if (!isPaidCheckoutSession(session)) break;
        const meta = session.metadata;
        const pi = session.payment_intent
          ? (typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent.id)
          : null;
        if (!pi) throw new Error('Paid vault checkout completed without a payment intent id');
        outcome = 'ok';
        mutate = () => getCreateVaultUnlock()(db, {
          listenerId:      parseInt(meta.vault_listener_id, 10),
          unlockType:      meta.vault_unlock_type,
          targetId:        meta.vault_target_id ? parseInt(meta.vault_target_id, 10) : null,
          paymentType:     'one_time',
          amountPaid:      session.amount_total || 0,
          stripePaymentId: pi,
          expiresAt:       null,
        });
        break;
      }

      const email = session.customer_details?.email || session.customer_email;
      if (!email || !session.subscription) break;

      // Stripe API call happens HERE, outside the transaction.
      const sub = await stripe.subscriptions.retrieve(session.subscription);
      if (!isStripeSubscriptionActive(sub) || !currentPeriodEndIso(sub)) break;
      outcome = 'ok';
      mutate = () => {
        // INSERT OR IGNORE — idempotent if a duplicate event fires for same email
        const ph = require('crypto').randomBytes(32).toString('hex');
        db.prepare(
          'INSERT OR IGNORE INTO listener_accounts (email, password_hash) VALUES (?, ?)'
        ).run(email, ph);
        const account = db.prepare('SELECT id FROM listener_accounts WHERE email = ?').get(email);

        activateSubscription(db, {
          providerSubscriptionId: sub.id,
          provider: 'stripe',
          tier: 'subscriber',
          currentPeriodEnd: currentPeriodEndIso(sub),
          listenerIdOrEmail: account.id,
        });

        // Also handle vault unlock if metadata present (vault recurring checkout)
        if (session.metadata?.vault_unlock_type && session.metadata?.vault_listener_id) {
          const meta = session.metadata;
          getCreateVaultUnlock()(db, {
            listenerId:      parseInt(meta.vault_listener_id, 10),
            unlockType:      meta.vault_unlock_type,
            targetId:        meta.vault_target_id ? parseInt(meta.vault_target_id, 10) : null,
            paymentType:     meta.vault_payment_type || 'recurring',
            amountPaid:      session.amount_total || 0,
            stripePaymentId: sub.id,
            expiresAt:       currentPeriodEndIso(sub),
          });
        }
      };
      break;
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub = event.data.object;
      const tier = sub.metadata?.tier;
      const vaultUnlockType = sub.metadata?.vault_unlock_type;

      if (tier && isStripeSubscriptionActive(sub) && currentPeriodEndIso(sub)) {
        outcome = 'ok';
        mutate = () => activateSubscription(db, {
          providerSubscriptionId: sub.id,
          provider: 'stripe',
          tier,
          currentPeriodEnd: currentPeriodEndIso(sub),
          listenerIdOrEmail: parseInt(sub.metadata?.listener_id, 10),
        });
      } else if (vaultUnlockType && sub.metadata?.vault_listener_id) {
        // Recurring vault unlock subscription
        const meta = sub.metadata;
        const expiresAt = currentPeriodEndIso(sub);
        outcome = 'ok';
        mutate = () => {
          const existing = db.prepare(
            'SELECT id FROM vault_unlocks WHERE stripe_payment_id = ?'
          ).get(sub.id);
          if (existing) {
            db.prepare(
              "UPDATE vault_unlocks SET active = ?, expires_at = ? WHERE id = ?"
            ).run(isStripeSubscriptionActive(sub) ? 1 : 0, expiresAt, existing.id);
          } else if (isStripeSubscriptionActive(sub) && expiresAt) {
            getCreateVaultUnlock()(db, {
              listenerId:      parseInt(meta.vault_listener_id, 10),
              unlockType:      vaultUnlockType,
              targetId:        meta.vault_target_id ? parseInt(meta.vault_target_id, 10) : null,
              paymentType:     'recurring',
              amountPaid:      0,
              stripePaymentId: sub.id,
              expiresAt,
            });
          }
        };
      } else if (event.type === 'customer.subscription.updated') {
        outcome = 'ok';
        mutate = () => {
          refreshExistingStripeSubscription(db, sub);
        };
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const subId = event.data.object.id;
      outcome = 'ok';
      mutate = () => {
        cancelSubscription(db, { providerSubscriptionId: subId });
        // Also deactivate any vault unlock tied to this subscription
        db.prepare("UPDATE vault_unlocks SET active = 0 WHERE stripe_payment_id = ?").run(subId);
      };
      break;
    }

    // Tip payments — payment_intent.succeeded fires for every successful payment
    // including subscription invoice renewals. Only act on intents tagged type:'tip'.
    case 'payment_intent.succeeded': {
      const pi = event.data.object;
      if (pi.metadata?.type !== 'tip') break;

      const amountCents = parseInt(pi.metadata?.amount_cents, 10) || pi.amount_received;
      outcome = 'ok';
      mutate = () => {
        // ON CONFLICT DO NOTHING — idempotent against idx_tips_payment_intent if the
        // tip-success redirect already logged this intent.
        db.prepare(
          'INSERT INTO tips (amount_cents, stripe_payment_intent_id) VALUES (?, ?) ON CONFLICT DO NOTHING'
        ).run(amountCents, pi.id);
        log('info', 'payment', `Tip confirmed via webhook: $${(amountCents / 100).toFixed(2)} (${pi.id})`);
      };
      break;
    }

    // Payment failure — mark the subscription inactive so access is revoked at the
    // next access check. Stripe retries the charge; recovery reactivates via
    // customer.subscription.updated.
    case 'invoice.payment_failed': {
      const subscriptionId = event.data.object.subscription;
      if (subscriptionId) {
        outcome = 'ok';
        mutate = () => {
          cancelSubscription(db, { providerSubscriptionId: subscriptionId });
          db.prepare("UPDATE vault_unlocks SET active = 0 WHERE stripe_payment_id = ?").run(subscriptionId);
        };
      }
      break;
    }

    // default: unhandled event type — recorded as 'skipped'.
  }

  try {
    const status = claimAndRun(
      db,
      { provider: 'stripe', eventId: event.id, eventType: event.type, outcome },
      mutate
    );
    res.json({ received: true, duplicate: status === 'duplicate' });
  } catch (err) {
    // Mutation threw and rolled back (event not recorded) — let Stripe retry.
    log('error', 'payment', `Stripe webhook ${event.type} (${event.id}) failed: ${err.message}`);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
}

module.exports = router;
module.exports.stripeWebhookHandler = stripeWebhookHandler;
// Exported for unit tests — the core subscription state transitions, exercised
// by both the Stripe and PayPal webhook handlers.
module.exports.activateSubscription = activateSubscription;
module.exports.cancelSubscription = cancelSubscription;
module.exports.claimAndRun = claimAndRun;
module.exports.currentPeriodEndIso = currentPeriodEndIso;
module.exports.isPaidCheckoutSession = isPaidCheckoutSession;
module.exports.isSucceededPaymentIntent = isSucceededPaymentIntent;
module.exports.isStripeSubscriptionActive = isStripeSubscriptionActive;
module.exports.refreshExistingStripeSubscription = refreshExistingStripeSubscription;
