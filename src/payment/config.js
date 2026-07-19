// Payment provider credentials — dashboard-entered values (app_settings) take
// priority over .env, falling back to .env for installs that still configure
// Stripe/PayPal that way. Mirrors src/email/index.js's smtpSettings() shape.

const { getSetting } = require('../db/settings');

function val(dbKey, envKey) {
  const v = getSetting(dbKey);
  if (v !== null && v !== '') return v;
  return process.env[envKey] || '';
}

function stripeSecretKey()       { return val('stripe_secret_key', 'STRIPE_SECRET_KEY'); }
function stripeWebhookSecret()   { return val('stripe_webhook_secret', 'STRIPE_WEBHOOK_SECRET'); }
function stripePriceSubscriber() { return val('stripe_price_subscriber', 'STRIPE_PRICE_SUBSCRIBER'); }
function stripePricePro()        { return val('stripe_price_pro', 'STRIPE_PRICE_PRO'); }
function stripePriceAllAccess()  { return val('stripe_price_all_access', 'STRIPE_PRICE_ALL_ACCESS'); }
function paypalClientId()        { return val('paypal_client_id', 'PAYPAL_CLIENT_ID'); }
function paypalClientSecret()    { return val('paypal_client_secret', 'PAYPAL_CLIENT_SECRET'); }
function paypalPlanPro()         { return val('paypal_plan_pro', 'PAYPAL_PLAN_PRO'); }
function paypalPlanAllAccess()   { return val('paypal_plan_all_access', 'PAYPAL_PLAN_ALL_ACCESS'); }
function paypalWebhookId()       { return val('paypal_webhook_id', 'PAYPAL_WEBHOOK_ID'); }

function isStripeConfigured() {
  return !!(stripeSecretKey() && stripeWebhookSecret()
    && stripePriceSubscriber() && stripePricePro() && stripePriceAllAccess());
}

function isPaypalConfigured() {
  return !!(paypalClientId() && paypalClientSecret());
}

module.exports = {
  stripeSecretKey,
  stripeWebhookSecret,
  stripePriceSubscriber,
  stripePricePro,
  stripePriceAllAccess,
  paypalClientId,
  paypalClientSecret,
  paypalPlanPro,
  paypalPlanAllAccess,
  paypalWebhookId,
  isStripeConfigured,
  isPaypalConfigured,
};
