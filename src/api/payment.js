const router = require('express').Router();
const { getDb } = require('../db');
const config = require('../config');

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
// Body: { tier: 'pro'|'all_access', provider: 'stripe'|'paypal' }
// Returns: { checkoutUrl }
// Play opens this URL in a WebView. On success, Core redirects to
// paperweightplay://payment/success?tier=<tier>
router.post('/checkout', (req, res) => {
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
      success_url: `${config.station.publicUrl || req.headers.origin || ''}/payment/success?session_id={CHECKOUT_SESSION_ID}&tier=${tier}`,
      cancel_url: `paperweightplay://payment/cancel`,
      metadata: {
        listener_id: String(req.tokenRow.listener_id),
        tier,
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

// GET /api/payment/success
// Handles redirect from Stripe/PayPal after successful checkout.
// Completes the subscription and redirects to the app deep link.
router.get('/success', async (req, res) => {
  const { session_id, tier } = req.query;

  if (session_id && process.env.STRIPE_SECRET_KEY) {
    try {
      const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
      const session = await stripe.checkout.sessions.retrieve(session_id, {
        expand: ['subscription'],
      });

      const listenerId = session.metadata?.listener_id;
      const sub = session.subscription;

      if (listenerId && sub) {
        const db = getDb();
        activateSubscription(db, {
          providerSubscriptionId: sub.id,
          provider: 'stripe',
          tier: session.metadata.tier || tier,
          currentPeriodEnd: new Date(sub.current_period_end * 1000).toISOString(),
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

  try {
    switch (event.event_type) {
      case 'BILLING.SUBSCRIPTION.ACTIVATED': {
        const sub = event.resource;
        const [listenerIdStr, tier] = (sub.custom_id || '').split(':');
        const listenerId = parseInt(listenerIdStr, 10);

        if (listenerId && tier) {
          activateSubscription(db, {
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
        cancelSubscription(db, { providerSubscriptionId: event.resource.id });
        break;
      }
    }
  } catch (err) {
    // Log but still return 200 to prevent PayPal retries
  }

  res.json({ received: true });
});

// Exported as a standalone handler for mounting before express.json() in index.js
// so the raw body buffer is available for Stripe signature verification.
function stripeWebhookHandler(req, res) {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    return res.status(503).json({ error: 'Stripe webhook not configured' });
  }

  let event;
  try {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    return res.status(400).json({ error: `Webhook signature invalid: ${err.message}` });
  }

  const db = getDb();

  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub = event.data.object;
      const tier = sub.metadata?.tier;
      if (tier && sub.status === 'active') {
        activateSubscription(db, {
          providerSubscriptionId: sub.id,
          provider: 'stripe',
          tier,
          currentPeriodEnd: new Date(sub.current_period_end * 1000).toISOString(),
          listenerIdOrEmail: parseInt(sub.metadata?.listener_id, 10),
        });
      }
      break;
    }
    case 'customer.subscription.deleted': {
      cancelSubscription(db, { providerSubscriptionId: event.data.object.id });
      break;
    }
  }

  res.json({ received: true });
}

module.exports = router;
module.exports.stripeWebhookHandler = stripeWebhookHandler;
