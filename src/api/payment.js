const router = require('express').Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { getDb, log } = require('../db');
const { hashToken } = require('../auth');
const config = require('../config');
const { paymentLimiter } = require('../middleware/rateLimiter');
const { cloudOnly } = require('../middleware/cloudGate');
const asyncHandler = require('../middleware/asyncHandler');
const { publicBaseUrl } = require('../runtime/base-url');
const { isEmailConfigured, sendMail } = require('../email');
const paymentConfig = require('../payment/config');
const { recordAudienceEvent, recordSubscriptionEvent } = require('../events');

const VALID_TIERS = new Set(['subscriber', 'pro', 'all_access']);

// Lazy-loaded to avoid circular dependency at module init time
// (vault.js → router.js → payment.js, and payment.js → vault.js)
function getCreateVaultUnlock() {
  return require('./vault').createVaultUnlock;
}

// Lazy-loaded for the same reason — listener.js lazily requires this module
// (account deletion's provider-side cancel), so this module must not require
// listener.js at top level either.
function getListenerHelpers() {
  return require('./listener');
}

// Fire-and-forget verification email sent the first time an account goes
// paid while unverified. Never blocks the caller (webhook or checkout
// redirect) on SMTP latency/failure.
function sendVerificationEmail(db, listenerId) {
  if (!isEmailConfigured()) return;
  const account = db.prepare('SELECT id, email FROM listener_accounts WHERE id = ?').get(listenerId);
  if (!account) return;

  const { createEmailToken, verifyLinkUrl } = getListenerHelpers();
  const { token } = createEmailToken(db, account.id, 'verify', 24 * 60);
  const url = verifyLinkUrl(null, token);
  const station = config.station.name || 'Paperweight';
  setImmediate(() => {
    sendMail({
      to: account.email,
      subject: `Verify your email for ${station}`,
      text: [
        `Thanks for supporting ${station}! Please confirm this is your email address.`,
        '',
        'Open this link to verify (valid for 24 hours):',
        url,
        '',
        "If you don't verify within 24 hours, paid content access will pause until you do.",
      ].join('\n'),
    }).catch(err => {
      log('error', 'payment', `Verification email to listener #${account.id} failed: ${err.message}`);
    });
  });
}

const ACTIVE_STRIPE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing']);

function isStripeSubscriptionActive(sub) {
  return !!(sub && ACTIVE_STRIPE_SUBSCRIPTION_STATUSES.has(sub.status));
}

// Maps a subscription's paid Stripe price to a tier using the server's own price
// IDs. This is the authoritative source — prefer it over client-influenced
// metadata so a subscriber can never be granted a higher tier than they paid for.
function tierFromStripeSubscription(sub) {
  const priceId = sub?.items?.data?.[0]?.price?.id;
  if (!priceId) return null;
  const byPrice = {
    [paymentConfig.stripePriceSubscriber()]: 'subscriber',
    [paymentConfig.stripePricePro()]:        'pro',
    [paymentConfig.stripePriceAllAccess()]:  'all_access',
  };
  const tier = byPrice[priceId];
  return VALID_TIERS.has(tier) ? tier : null;
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

function newCheckoutNonce() {
  return crypto.randomBytes(24).toString('hex');
}

function createPendingListener(db, nonce) {
  const email = `stripe-${nonce}@pending.paperweight.local`;
  const passwordHash = crypto.randomBytes(32).toString('hex');
  const info = db.prepare(
    'INSERT INTO listener_accounts (email, password_hash) VALUES (?, ?)'
  ).run(email, passwordHash);
  return info.lastInsertRowid;
}

const TIP_SUPPORTER_DAYS = 7;

// Find-or-create for a donor email captured on the tip form. Unlike
// createPendingListener's synthetic email, this uses the donor's real
// address and a real (bcrypt, synchronous) temp password so it can be
// emailed to them as usable login credentials. Synchronous throughout —
// this may run inside claimAndRun's transaction (webhook path), which
// better-sqlite3 requires to be fully synchronous.
function findOrCreateListenerByEmail(db, email) {
  const existing = db.prepare('SELECT id FROM listener_accounts WHERE email = ?').get(email);
  if (existing) return { listenerId: existing.id, isNewAccount: false, tempPassword: null };

  const tempPassword = crypto.randomBytes(6).toString('hex');
  const passwordHash = bcrypt.hashSync(tempPassword, 10);
  const info = db.prepare(
    'INSERT INTO listener_accounts (email, password_hash) VALUES (?, ?)'
  ).run(email, passwordHash);
  return { listenerId: info.lastInsertRowid, isNewAccount: true, tempPassword };
}

// Grants (or refreshes) 7 days of subscriber-tier access via the same
// subscriptions table every other tier grant uses, so it expires on its own
// through the existing activeSubscriptionTierForListener logic — no separate
// scheduler needed. Idempotent per payment intent via activateSubscription's
// upsert-by-provider_subscription_id lookup, so the webhook and the
// tip-success redirect can both call this safely.
function grantTipSupporterAccess(db, { listenerId, paymentIntentId }) {
  const currentPeriodEnd = new Date(Date.now() + TIP_SUPPORTER_DAYS * 24 * 60 * 60 * 1000).toISOString();
  return activateSubscription(db, {
    providerSubscriptionId: `tip-${paymentIntentId}`,
    provider: 'tip',
    tier: 'subscriber',
    currentPeriodEnd,
    listenerIdOrEmail: listenerId,
  });
}

function refreshExistingStripeSubscription(db, sub) {
  if (!sub?.id || !isStripeSubscriptionActive(sub)) return false;
  const existing = db.prepare(
    'SELECT id, listener_id, tier FROM subscriptions WHERE provider_subscription_id = ?'
  ).get(sub.id);
  const periodEnd = currentPeriodEndIso(sub);
  if (!existing || !periodEnd) return false;

  const tier = tierFromStripeSubscription(sub) || sub.metadata?.tier || existing.tier;
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
function activateSubscription(db, {
  providerSubscriptionId, provider, tier, currentPeriodEnd, listenerIdOrEmail,
  amountCents = null, currency = null, billingInterval = null, providerEventId = null,
}) {
  // Resolve listener_id from email if needed
  let listenerId = listenerIdOrEmail;
  if (typeof listenerIdOrEmail === 'string' && listenerIdOrEmail.includes('@')) {
    const account = db.prepare('SELECT id FROM listener_accounts WHERE email = ?').get(listenerIdOrEmail);
    if (!account) return false;
    listenerId = account.id;
  }

  // Upsert subscription record
  const existing = db.prepare(
    'SELECT * FROM subscriptions WHERE listener_id = ? AND provider_subscription_id = ?'
  ).get(listenerId, providerSubscriptionId);

  let subscriptionId;
  if (existing) {
    db.prepare(
      "UPDATE subscriptions SET tier = ?, status = 'active', current_period_end = ?, amount_cents = COALESCE(?, amount_cents), currency = COALESCE(?, currency), billing_interval = COALESCE(?, billing_interval) WHERE id = ?"
    ).run(tier, currentPeriodEnd, amountCents, currency, billingInterval, existing.id);
    subscriptionId = existing.id;
  } else {
    const info = db.prepare(
      'INSERT INTO subscriptions (listener_id, tier, provider, provider_subscription_id, status, current_period_end, amount_cents, currency, billing_interval) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(listenerId, tier, provider, providerSubscriptionId, 'active', currentPeriodEnd, amountCents, currency, billingInterval);
    subscriptionId = Number(info.lastInsertRowid);
  }

  // Sync token tier
  db.prepare(
    'UPDATE tokens SET tier = ? WHERE listener_id = ? AND is_active = 1'
  ).run(tier, listenerId);

  // Starts the email-verification grace clock exactly once, the first time
  // this account goes paid while unverified (see src/auth/access.js for the
  // 24h gate this feeds). Never reset on renewal; already-paid accounts from
  // before this shipped are grandfathered (this UPDATE never touches them
  // since it only ever runs on a fresh subscription activation).
  const graceStarted = db.prepare(
    `UPDATE listener_accounts SET email_verification_required_at = datetime('now')
     WHERE id = ? AND email_verified_at IS NULL AND email_verification_required_at IS NULL`
  ).run(listenerId);
  if (graceStarted.changes > 0) sendVerificationEmail(db, listenerId);

  const lifecycleType = existing ? 'subscription_renewed' : 'subscription_started';
  const lifecycleKey = `${provider}:${providerSubscriptionId}:${lifecycleType}:${currentPeriodEnd}`;
  recordSubscriptionEvent(db, {
    subscriptionId, listenerId, eventType: lifecycleType, tier, status: 'active',
    amountCents, currency, billingInterval, provider, providerEventId,
    providerSubscriptionId, dedupeKey: lifecycleKey,
  });
  recordAudienceEvent(lifecycleType, {
    db, listenerId, source: 'webhook', valueCents: amountCents,
    currency, dedupeKey: `audience:${lifecycleKey}`,
    metadata: { tier, provider, billing_interval: billingInterval },
  });

  return true;
}

function recordTipAudienceEvent(db, { amountCents, paymentIntentId, donorEmail }) {
  const account = donorEmail
    ? db.prepare('SELECT id FROM listener_accounts WHERE lower(email) = lower(?)').get(donorEmail)
    : null;
  recordAudienceEvent('tip_completed', {
    db,
    listenerId: account?.id,
    source: 'webhook',
    valueCents: Number(amountCents || 0),
    currency: 'usd',
    dedupeKey: `tip:${paymentIntentId}`,
  });
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

  const eventType = 'subscription_expired';
  const key = `${sub.provider}:${providerSubscriptionId}:${eventType}:${sub.current_period_end}`;
  recordSubscriptionEvent(db, {
    subscriptionId: sub.id, listenerId: sub.listener_id, eventType,
    tier: sub.tier, status: 'expired', amountCents: sub.amount_cents,
    currency: sub.currency, billingInterval: sub.billing_interval,
    provider: sub.provider, providerSubscriptionId, dedupeKey: key,
  });
  recordAudienceEvent(eventType, {
    db, listenerId: sub.listener_id, source: 'webhook', dedupeKey: `audience:${key}`,
    metadata: { tier: sub.tier, provider: sub.provider },
  });

  return true;
}

// Cancels a subscription at the payment provider. Stripe defaults to
// cancel-at-period-end (access continues until the paid period lapses; the
// customer.subscription.deleted webhook downgrades locally). immediate: true is
// used by account deletion. PayPal only supports immediate cancellation of
// future billing; its CANCELLED webhook performs the local downgrade.
async function providerCancelSubscription(sub, { immediate = false } = {}) {
  if (sub.provider === 'stripe') {
    const stripeKey = paymentConfig.stripeSecretKey();
    if (!stripeKey) throw new Error('Stripe is not configured on this server');
    const stripe = require('stripe')(stripeKey);
    if (immediate) {
      await stripe.subscriptions.cancel(sub.provider_subscription_id);
    } else {
      await stripe.subscriptions.update(sub.provider_subscription_id, { cancel_at_period_end: true });
    }
    return;
  }

  if (sub.provider === 'paypal') {
    const clientId = paymentConfig.paypalClientId();
    const clientSecret = paymentConfig.paypalClientSecret();
    if (!clientId || !clientSecret) throw new Error('PayPal is not configured on this server');
    const accessToken = await getPayPalAccessToken(clientId, clientSecret);
    const cancelRes = await fetch(
      `https://api-m.paypal.com/v1/billing/subscriptions/${encodeURIComponent(sub.provider_subscription_id)}/cancel`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ reason: 'Cancelled by the listener from the station player' }),
      }
    );
    // 204 = cancelled; 422 = already cancelled/expired — treat as success.
    if (!cancelRes.ok && cancelRes.status !== 422) {
      throw new Error(`PayPal cancel failed with HTTP ${cancelRes.status}`);
    }
    return;
  }

  throw new Error(`Unknown subscription provider: ${sub.provider}`);
}

// POST /api/payment/subscription/cancel
// Self-service cancellation for the authenticated listener's active subscription.
router.post('/subscription/cancel', paymentLimiter, asyncHandler(async (req, res) => {
  if (!req.tokenRow || !req.tokenRow.listener_id) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const db = getDb();
  const sub = db.prepare(
    "SELECT * FROM subscriptions WHERE listener_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1"
  ).get(req.tokenRow.listener_id);
  if (!sub) return res.status(404).json({ error: 'No active subscription found' });

  try {
    await providerCancelSubscription(sub);
  } catch (err) {
    log('error', 'payment', `Listener-initiated cancel failed for ${sub.provider} ${sub.provider_subscription_id}: ${err.message}`);
    return res.status(502).json({ error: `Could not cancel with ${sub.provider} — try again or cancel from your ${sub.provider} account.` });
  }

  log('info', 'payment', `Listener #${sub.listener_id} cancelled ${sub.provider} subscription ${sub.provider_subscription_id}`);
  res.json({
    ok: true,
    provider: sub.provider,
    // Stripe access continues until the paid period ends; PayPal processes the
    // cancellation on its side and the webhook downgrades when it lands.
    effectiveUntil: sub.provider === 'stripe' ? sub.current_period_end : null,
  });
}));

// POST /api/payment/portal
// Returns a Stripe billing-portal URL where the listener can manage payment
// methods, invoices, and cancellation. Stripe subscriptions only.
router.post('/portal', paymentLimiter, asyncHandler(async (req, res) => {
  if (!req.tokenRow || !req.tokenRow.listener_id) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const stripeKey = paymentConfig.stripeSecretKey();
  if (!stripeKey) return res.status(503).json({ error: 'Stripe is not configured on this server' });

  const db = getDb();
  const sub = db.prepare(
    "SELECT * FROM subscriptions WHERE listener_id = ? AND provider = 'stripe' AND status = 'active' ORDER BY created_at DESC LIMIT 1"
  ).get(req.tokenRow.listener_id);
  if (!sub) return res.status(404).json({ error: 'No active Stripe subscription found' });

  try {
    const stripe = require('stripe')(stripeKey);
    const stripeSub = await stripe.subscriptions.retrieve(sub.provider_subscription_id);
    const customer = typeof stripeSub.customer === 'string' ? stripeSub.customer : stripeSub.customer?.id;
    if (!customer) return res.status(502).json({ error: 'Stripe subscription has no customer attached' });

    const base = publicBaseUrl(req);
    const session = await stripe.billingPortal.sessions.create({
      customer,
      return_url: `${base}/#player`,
    });
    res.json({ url: session.url });
  } catch (err) {
    log('error', 'payment', `Billing portal session failed: ${err.message}`);
    res.status(502).json({ error: 'Could not open the billing portal — try again later' });
  }
}));

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
  const stripeKey = paymentConfig.stripeSecretKey();
  if (!stripeKey) {
    return res.status(503).json({ error: 'Stripe is not configured on this server' });
  }

  const priceId = tier === 'pro'
    ? paymentConfig.stripePricePro()
    : paymentConfig.stripePriceAllAccess();

  if (!priceId) {
    return res.status(503).json({ error: `Stripe price ID for ${tier} is not configured` });
  }

  try {
    const stripe = require('stripe')(stripeKey);
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${publicBaseUrl(req)}/payment/success?session_id={CHECKOUT_SESSION_ID}&tier=${tier}`,
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
  const clientId = paymentConfig.paypalClientId();
  const clientSecret = paymentConfig.paypalClientSecret();

  if (!clientId || !clientSecret) {
    return res.status(503).json({ error: 'PayPal is not configured on this server' });
  }

  const planId = tier === 'pro'
    ? paymentConfig.paypalPlanPro()
    : paymentConfig.paypalPlanAllAccess();

  if (!planId) {
    return res.status(503).json({ error: `PayPal plan ID for ${tier} is not configured` });
  }

  try {
    const access_token = await getPayPalAccessToken(clientId, clientSecret);

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
          return_url: `${publicBaseUrl(req)}/payment/success?tier=${tier}`,
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
router.get('/success', cloudOnly, asyncHandler(async (req, res) => {
  const { session_id, tier } = req.query;

  if (session_id && paymentConfig.stripeSecretKey()) {
    try {
      const stripe = require('stripe')(paymentConfig.stripeSecretKey());
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
}));

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
router.get('/checkout-url', paymentLimiter, asyncHandler(async (req, res) => {
  const stripeKey = paymentConfig.stripeSecretKey();
  if (!stripeKey) {
    return res.status(503).json({ error: 'Stripe not configured on this server' });
  }

  const priceId = paymentConfig.stripePriceSubscriber();
  if (!priceId) {
    return res.status(503).json({ error: 'Subscriber price not configured — set it in the dashboard Payments section' });
  }

  try {
    const stripe = require('stripe')(stripeKey);
    const db = getDb();
    const nonce = newCheckoutNonce();
    const listenerId = req.tokenRow?.listener_id || createPendingListener(db, nonce);
    const base = publicBaseUrl(req);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${base}/api/payment/web-success?session_id={CHECKOUT_SESSION_ID}&nonce=${nonce}`,
      cancel_url:  `${base}/#library`,
      metadata: {
        listener_id: String(listenerId),
        tier: 'subscriber',
        nonce,
      },
      subscription_data: {
        metadata: {
          listener_id: String(listenerId),
          tier: 'subscriber',
          nonce,
        },
      },
    });
    db.prepare(
      'INSERT INTO pending_checkouts (nonce, provider, stripe_session_id, listener_id, tier, expires_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(nonce, 'stripe', session.id, listenerId, 'subscriber', expiresAt);
    recordAudienceEvent('checkout_started', {
      req, db, listenerId, source: 'checkout', dedupeKey: `subscription-checkout:${session.id}`,
      metadata: { kind: 'subscription', tier: 'subscriber', provider: 'stripe' },
    });
    res.json({ checkoutUrl: session.url });
  } catch {
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
}));

// GET /api/payment/web-success?session_id=xxx
// Stripe redirects here after a successful web checkout.
// Retrieves a locally-bound checkout session, activates the pending listener,
// sets the pw_token cookie, then redirects to the library with ?subscribed=1.
router.get('/web-success', asyncHandler(async (req, res) => {
  const { session_id, nonce } = req.query;

  if (!session_id || !nonce || !paymentConfig.stripeSecretKey()) {
    return res.redirect('/#library');
  }

  try {
    const db = getDb();
    const pending = db.prepare(
      "SELECT * FROM pending_checkouts WHERE nonce = ? AND provider = 'stripe' AND consumed_at IS NULL"
    ).get(String(nonce));
    if (!pending || pending.stripe_session_id !== String(session_id) || new Date(pending.expires_at) < new Date()) {
      return res.redirect('/#library');
    }

    const stripe = require('stripe')(paymentConfig.stripeSecretKey());
    const session = await stripe.checkout.sessions.retrieve(session_id, {
      expand: ['subscription'],
    });

    const sub   = session.subscription;
    const metadataListenerId = parseInt(session.metadata?.listener_id || sub?.metadata?.listener_id, 10);
    if (metadataListenerId !== pending.listener_id || session.metadata?.nonce !== String(nonce)) {
      return res.redirect('/#library');
    }

    if (sub && sub.id && isStripeSubscriptionActive(sub) && currentPeriodEndIso(sub)) {
      // Mint a fresh auth token for this browser and store only its hash. The raw
      // value is used once (below) to set the cookie and is never persisted.
      const rawToken = crypto.randomBytes(32).toString('hex');
      const rawTokenHash = hashToken(rawToken);
      const label = session.customer_details?.email || session.customer_email || null;
      db.prepare(
        "INSERT INTO tokens (token, token_hash, label, tier, listener_id) VALUES (?, ?, ?, 'subscriber', ?)"
      ).run(rawTokenHash, rawTokenHash, label, pending.listener_id);

      activateSubscription(db, {
        providerSubscriptionId: sub.id,
        provider:               'stripe',
        tier:                   pending.tier,
        currentPeriodEnd:       currentPeriodEndIso(sub),
        listenerIdOrEmail:      pending.listener_id,
      });

      db.prepare("UPDATE pending_checkouts SET consumed_at = datetime('now') WHERE id = ?").run(pending.id);

      // Set auth cookie — httpOnly, 1-year expiry
      const isSecure = config.https || req.secure || req.headers['x-forwarded-proto'] === 'https';
      res.cookie('pw_token', rawToken, {
        httpOnly: true,
        secure:   isSecure,
        sameSite: 'lax',
        maxAge:   365 * 24 * 60 * 60 * 1000,
      });
    }
  } catch { /* log but don't block redirect — webhook is the authoritative record */ }

  res.redirect('/?subscribed=1#library');
}));

// ─── Tip flow ────────────────────────────────────────────────────────────────

// GET /api/payment/tip-config
// Public — no auth. Returns creator-configured tip amounts.
// Returns { enabled: false } if Stripe is not configured.
router.get('/tip-config', (req, res) => {
  if (!paymentConfig.stripeSecretKey()) {
    return res.json({ enabled: false, amounts: [], customEnabled: false });
  }
  const row = getDb().prepare('SELECT amounts, custom_enabled FROM tip_config WHERE id = 1').get();
  let amounts = [300, 500, 1000];
  try { if (row) amounts = JSON.parse(row.amounts); } catch {}
  const customEnabled = row ? row.custom_enabled === 1 : true;
  res.json({ enabled: true, amounts, customEnabled });
});

// Both optional; leaving them blank is how a tip stays anonymous. Truncated
// defensively — Stripe metadata values are capped at 500 chars each anyway.
// NOTE: this strips control characters only, not HTML — it is not safe to
// insert into markup via innerHTML. Any future UI that displays donor_name
// must escape it at render time (JSX text content auto-escapes; a raw DOM
// consumer would need textContent or an equivalent helper), the same as
// every other creator/listener-supplied string.
function cleanDonorName(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string') return undefined; // signals "invalid" to the caller
  const name = raw.trim().replace(/[\x00-\x1F\x7F]/g, '').slice(0, 100);
  return name || null;
}

function cleanDonorEmail(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string' || !raw.includes('@') || raw.length > 254) return undefined;
  return raw.toLowerCase().trim();
}

// POST /api/payment/tip
// Public — no auth. Body: { amountCents: number, donorName?, donorEmail? }
// Creates a Stripe Checkout session (mode: 'payment') for a one-time tip.
// donorName/donorEmail are optional and tagged onto the Stripe metadata so the
// success redirect and webhook can grant a 7-day supporter account after
// payment — this route itself still creates nothing.
router.post('/tip', paymentLimiter, asyncHandler(async (req, res) => {
  const stripeKey = paymentConfig.stripeSecretKey();
  if (!stripeKey) return res.status(503).json({ error: 'Stripe not configured on this server' });

  const amountCents = parseInt(req.body.amountCents, 10);
  if (!amountCents || amountCents < 100) {
    return res.status(400).json({ error: 'Minimum tip is $1.00 (100 cents)' });
  }
  if (amountCents > 100000) {
    return res.status(400).json({ error: 'Amount exceeds maximum allowed tip' });
  }

  const donorName = cleanDonorName(req.body.donorName);
  const donorEmail = cleanDonorEmail(req.body.donorEmail);
  if (donorName === undefined) return res.status(400).json({ error: 'Invalid name' });
  if (donorEmail === undefined) return res.status(400).json({ error: 'Invalid email address' });

  try {
    const stripe      = require('stripe')(stripeKey);
    const base        = publicBaseUrl(req);
    const stationName = config.station.name || 'the station';

    const piMetadata = { type: 'tip', amount_cents: String(amountCents) };
    if (donorName) piMetadata.donor_name = donorName;
    if (donorEmail) piMetadata.donor_email = donorEmail;

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
      metadata:             piMetadata,
      payment_intent_data:  { metadata: piMetadata },
    });

    recordAudienceEvent('checkout_started', {
      req, source: 'checkout', valueCents: amountCents, currency: 'usd',
      dedupeKey: `tip-checkout:${session.id}`,
      metadata: { kind: 'tip', provider: 'stripe' },
    });

    res.json({ checkoutUrl: session.url });
  } catch (err) {
    log('error', 'payment', `Tip checkout failed: ${err.message}`);
    res.status(500).json({ error: err.message || 'Failed to create tip checkout' });
  }
}));

// Grants 7-day supporter access for a tip with a donor email attached, then
// gets the browser logged in — via an emailed magic link + credentials when
// SMTP is configured, or straight onto this response's cookie when it isn't
// (the "if that's not possible, just log them in" fallback). Only called from
// the redirect handler (never the webhook) so the email/cookie side effect
// fires exactly once per tip, even though the DB grant itself is idempotent.
function grantTipAccessAndSignIn(req, res, db, { donorEmail, paymentIntentId }) {
  let listenerId;
  let isNewAccount = false;
  let tempPassword = null;

  if (req.tokenRow?.listener_id) {
    // Already logged in — extend their existing account instead of creating
    // a second one for the same person.
    listenerId = req.tokenRow.listener_id;
  } else {
    const found = findOrCreateListenerByEmail(db, donorEmail);
    listenerId = found.listenerId;
    isNewAccount = found.isNewAccount;
    tempPassword = found.tempPassword;
  }

  grantTipSupporterAccess(db, { listenerId, paymentIntentId });

  if (isEmailConfigured()) {
    const { createEmailToken, autoLoginLinkUrl } = getListenerHelpers();
    const { token } = createEmailToken(db, listenerId, 'login', 30);
    const url = autoLoginLinkUrl(null, token);
    const station = config.station.name || 'Paperweight';
    const lines = [`Thank you for supporting ${station}!`, '', `You now have ${TIP_SUPPORTER_DAYS} days of supporter access.`, ''];
    if (isNewAccount) {
      lines.push(
        `We created an account for you: ${donorEmail}`,
        `Temporary password: ${tempPassword}`,
        '(you can change this any time from Settings)',
        '',
      );
    }
    lines.push('Click below to log in instantly:', url);
    setImmediate(() => {
      sendMail({ to: donorEmail, subject: `You're a ${station} supporter`, text: lines.join('\n') }).catch(err => {
        log('error', 'payment', `Tip supporter email to listener #${listenerId} failed: ${err.message}`);
      });
    });
    return;
  }

  // No SMTP configured — just log them in directly.
  const { issueToken } = getListenerHelpers();
  const issued = issueToken(db, listenerId, 'subscriber');
  res.cookie('pw_token', issued.token, {
    httpOnly: true,
    secure:   config.https || req.secure || req.headers['x-forwarded-proto'] === 'https',
    sameSite: 'lax',
    maxAge:   365 * 24 * 60 * 60 * 1000,
  });
}

// GET /api/payment/tip-success?session_id=xxx
// Stripe redirects here after a successful tip payment.
// Logs the tip, then redirects back to the station player with ?tipped=1.
// The webhook (payment_intent.succeeded) is the authoritative record;
// this handler logs opportunistically in case the webhook is delayed.
router.get('/tip-success', asyncHandler(async (req, res) => {
  const { session_id } = req.query;

  if (session_id && paymentConfig.stripeSecretKey()) {
    try {
      const stripe  = require('stripe')(paymentConfig.stripeSecretKey());
      const session = await stripe.checkout.sessions.retrieve(session_id, {
        expand: ['payment_intent'],
      });

      if (session.metadata?.type === 'tip' && isPaidCheckoutSession(session) && isSucceededPaymentIntent(session.payment_intent)) {
        const pi          = session.payment_intent;
        const amountCents = pi.amount_received || pi.amount;
        const donorName   = pi.metadata?.donor_name || null;
        const donorEmail  = pi.metadata?.donor_email || null;
        const db          = getDb();

        // ON CONFLICT DO NOTHING — idempotent against idx_tips_payment_intent if the
        // webhook already logged this intent (redirect and webhook race each other).
        // The account/grant/email step below runs regardless of which side won that
        // race: findOrCreateListenerByEmail and grantTipSupporterAccess are each
        // idempotent by design (find-or-create by email; upsert by payment intent id).
        db.prepare(
          'INSERT INTO tips (amount_cents, stripe_payment_intent_id, stripe_checkout_session_id, donor_name, donor_email) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING'
        ).run(amountCents, pi.id, session.id, donorName, donorEmail);

        log('info', 'payment', `Tip logged via redirect: $${(amountCents / 100).toFixed(2)} (${pi.id})`);

        if (donorEmail) {
          grantTipAccessAndSignIn(req, res, db, { donorEmail, paymentIntentId: pi.id });
        }
        recordTipAudienceEvent(db, { amountCents, paymentIntentId: pi.id, donorEmail });
      }
    } catch (err) {
      log('error', 'payment', `Tip-success redirect handling failed: ${err.message}`);
      /* webhook is authoritative — don't block redirect */
    }
  }

  res.redirect('/?tipped=1#player');
}));

// ─── Webhooks ─────────────────────────────────────────────────────────────────
// NOTE: The Stripe webhook is mounted separately in src/index.js BEFORE
// express.json() so Stripe can verify the raw request body signature.
// See module.exports.stripeWebhookHandler below.

// POST /api/payment/webhook/paypal
// PayPal sends events here. Must be registered in the PayPal developer console.
router.post('/webhook/paypal', asyncHandler(async (req, res) => {
  const clientId = paymentConfig.paypalClientId();
  const clientSecret = paymentConfig.paypalClientSecret();
  const webhookId = paymentConfig.paypalWebhookId();

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
      const customId = String(sub.custom_id || '');
      if (!customId || customId.length >= 256) {
        return res.status(400).json({ error: 'Invalid PayPal custom_id' });
      }
      const parts = customId.split(':');
      if (parts.length !== 2) {
        return res.status(400).json({ error: 'Invalid PayPal custom_id' });
      }
      const [listenerIdStr, tier] = parts;
      const listenerId = parseInt(listenerIdStr, 10);
      if (!listenerId || !VALID_TIERS.has(tier)) {
        return res.status(400).json({ error: 'Invalid PayPal custom_id' });
      }
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
}));

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
  const webhookSecret = paymentConfig.stripeWebhookSecret();

  if (!webhookSecret) {
    return res.status(503).json({ error: 'Stripe webhook not configured' });
  }

  const stripe = require('stripe')(paymentConfig.stripeSecretKey());
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

      if (!session.subscription) break;

      // Stripe API call happens HERE, outside the transaction.
      let sub;
      try {
        sub = await stripe.subscriptions.retrieve(session.subscription);
      } catch (err) {
        log('error', 'payment', `stripe.subscriptions.retrieve failed for ${session.subscription}: ${err.message}`);
        break;
      }
      if (!isStripeSubscriptionActive(sub) || !currentPeriodEndIso(sub)) break;

      // Recurring vault checkout: create the unlock, but do not create or bind a
      // listener account from Stripe's returned customer email.
      if (session.metadata?.vault_unlock_type && session.metadata?.vault_listener_id) {
        const meta = session.metadata;
        outcome = 'ok';
        mutate = () => getCreateVaultUnlock()(db, {
          listenerId:      parseInt(meta.vault_listener_id, 10),
          unlockType:      meta.vault_unlock_type,
          targetId:        meta.vault_target_id ? parseInt(meta.vault_target_id, 10) : null,
          paymentType:     meta.vault_payment_type || 'recurring',
          amountPaid:      session.amount_total || 0,
          stripePaymentId: sub.id,
          expiresAt:       currentPeriodEndIso(sub),
        });
        break;
      }

      const listenerId = parseInt(session.metadata?.listener_id || sub.metadata?.listener_id, 10);
      const tier = tierFromStripeSubscription(sub) || session.metadata?.tier || sub.metadata?.tier || 'subscriber';
      if (!listenerId || !VALID_TIERS.has(tier)) break;

      outcome = 'ok';
      mutate = () => activateSubscription(db, {
        providerSubscriptionId: sub.id,
        provider: 'stripe',
        tier,
        currentPeriodEnd: currentPeriodEndIso(sub),
        listenerIdOrEmail: listenerId,
      });
      break;
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub = event.data.object;
      const tier = tierFromStripeSubscription(sub) || sub.metadata?.tier;
      const vaultUnlockType = sub.metadata?.vault_unlock_type;
      const listenerId = parseInt(sub.metadata?.listener_id, 10);

      if (VALID_TIERS.has(tier) && listenerId && isStripeSubscriptionActive(sub) && currentPeriodEndIso(sub)) {
        outcome = 'ok';
        mutate = () => activateSubscription(db, {
          providerSubscriptionId: sub.id,
          provider: 'stripe',
          tier,
          currentPeriodEnd: currentPeriodEndIso(sub),
          listenerIdOrEmail: listenerId,
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
      const donorName   = pi.metadata?.donor_name || null;
      const donorEmail  = pi.metadata?.donor_email || null;
      outcome = 'ok';
      mutate = () => {
        // ON CONFLICT DO NOTHING — idempotent against idx_tips_payment_intent if the
        // tip-success redirect already logged this intent.
        db.prepare(
          'INSERT INTO tips (amount_cents, stripe_payment_intent_id, donor_name, donor_email) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING'
        ).run(amountCents, pi.id, donorName, donorEmail);
        log('info', 'payment', `Tip confirmed via webhook: $${(amountCents / 100).toFixed(2)} (${pi.id})`);

        // Authoritative safety net for the 7-day supporter grant in case the
        // tip-success redirect never ran (tab closed mid-checkout, etc). Does
        // not send an email/set a cookie — no browser response to act on here;
        // that only happens on the redirect path (grantTipAccessAndSignIn).
        if (donorEmail) {
          const { listenerId } = findOrCreateListenerByEmail(db, donorEmail);
          grantTipSupporterAccess(db, { listenerId, paymentIntentId: pi.id });
        }
        recordTipAudienceEvent(db, { amountCents, paymentIntentId: pi.id, donorEmail });
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
module.exports.providerCancelSubscription = providerCancelSubscription;
module.exports.currentPeriodEndIso = currentPeriodEndIso;
module.exports.isPaidCheckoutSession = isPaidCheckoutSession;
module.exports.isSucceededPaymentIntent = isSucceededPaymentIntent;
module.exports.isStripeSubscriptionActive = isStripeSubscriptionActive;
module.exports.refreshExistingStripeSubscription = refreshExistingStripeSubscription;
module.exports.findOrCreateListenerByEmail = findOrCreateListenerByEmail;
module.exports.grantTipSupporterAccess = grantTipSupporterAccess;
module.exports.getPayPalAccessToken = getPayPalAccessToken;
