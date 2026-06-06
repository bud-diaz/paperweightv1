// Startup security/configuration checks.
//
// Paperweight is self-hosted and frequently exposed to the public internet, so
// a handful of misconfigurations are worth flagging loudly at boot rather than
// discovering them when payments silently fail to grant access or an owner
// token leaks. These checks NEVER abort startup — they only surface warnings —
// because a creator may intentionally run locally without TLS or payments.
//
// collectStartupWarnings() is pure (takes an env object, returns strings) so it
// can be unit-tested without spinning up the server.

function isSet(v) {
  return typeof v === 'string' && v.trim() !== '';
}

function looksLocal(url) {
  return /localhost|127\.0\.0\.1|0\.0\.0\.0|\.local(?::|\/|$)/i.test(url);
}

function collectStartupWarnings(env = process.env) {
  const warnings = [];

  // ── Owner/admin auth ────────────────────────────────────────────────────────
  if (!isSet(env.DASHBOARD_TOKEN)) {
    warnings.push(
      'DASHBOARD_TOKEN is not set. A temporary token is generated on each start ' +
      '(printed above) and changes every restart. Set DASHBOARD_TOKEN in .env so ' +
      'owner/admin dashboard access is stable. Treat it as a single shared owner ' +
      'secret, not per-user team auth.'
    );
  }

  // ── Signed download URLs ─────────────────────────────────────────────────────
  if (!isSet(env.DOWNLOAD_SIGNING_SECRET)) {
    warnings.push(
      'DOWNLOAD_SIGNING_SECRET is not set. Signed download links are signed with a ' +
      'random secret regenerated on every restart, so any link already shared stops ' +
      'working after a restart. Set DOWNLOAD_SIGNING_SECRET in .env to make them stable.'
    );
  }

  // ── TLS vs. public URL ───────────────────────────────────────────────────────
  const publicUrl = isSet(env.STATION_PUBLIC_URL) ? env.STATION_PUBLIC_URL.trim() : '';
  const httpsOn   = env.HTTPS === 'true';
  if (publicUrl && !httpsOn && !/^https:\/\//i.test(publicUrl) && !looksLocal(publicUrl)) {
    warnings.push(
      `HTTPS=false but STATION_PUBLIC_URL is a public address (${publicUrl}). Cookies ` +
      'are sent without the Secure flag and traffic is unencrypted. Put Paperweight ' +
      'behind a TLS-terminating proxy (or tunnel) and set HTTPS=true.'
    );
  }

  // ── Stripe ───────────────────────────────────────────────────────────────────
  const stripeSecret  = isSet(env.STRIPE_SECRET_KEY);
  const stripeWebhook = isSet(env.STRIPE_WEBHOOK_SECRET);
  const stripePrice   = isSet(env.STRIPE_PRICE_SUBSCRIBER) ||
                        isSet(env.STRIPE_PRICE_PRO) ||
                        isSet(env.STRIPE_PRICE_ALL_ACCESS);

  if (stripeSecret) {
    if (!stripeWebhook) {
      warnings.push(
        'Stripe is configured (STRIPE_SECRET_KEY) but STRIPE_WEBHOOK_SECRET is missing. ' +
        'Webhook signatures cannot be verified, so subscription activation/cancellation ' +
        'events are rejected and paid access will not be granted. Set STRIPE_WEBHOOK_SECRET.'
      );
    }
    if (!stripePrice) {
      warnings.push(
        'Stripe is configured but no price IDs are set (STRIPE_PRICE_SUBSCRIBER / ' +
        'STRIPE_PRICE_PRO / STRIPE_PRICE_ALL_ACCESS). Checkout has nothing to sell.'
      );
    }
  } else if (stripeWebhook || stripePrice) {
    warnings.push(
      'Stripe is partially configured (a webhook secret or price ID is set) but ' +
      'STRIPE_SECRET_KEY is missing. Stripe payments are disabled until it is set.'
    );
  }

  // ── PayPal ───────────────────────────────────────────────────────────────────
  const ppId      = isSet(env.PAYPAL_CLIENT_ID);
  const ppSecret  = isSet(env.PAYPAL_CLIENT_SECRET);
  const ppWebhook = isSet(env.PAYPAL_WEBHOOK_ID);

  if (ppId || ppSecret) {
    if (!(ppId && ppSecret)) {
      warnings.push(
        'PayPal is partially configured. Both PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET ' +
        'are required; PayPal payments are disabled until both are set.'
      );
    } else if (!ppWebhook) {
      warnings.push(
        'PayPal is configured (client id + secret) but PAYPAL_WEBHOOK_ID is missing. ' +
        'Webhook events cannot be verified, so subscription activation/cancellation will ' +
        'not grant or revoke access. Set PAYPAL_WEBHOOK_ID.'
      );
    }
  }

  return warnings;
}

// Prints the collected warnings to the console and the DB log (if available).
// Accepts an optional logger so callers can route warnings into the app log.
function printStartupWarnings(env = process.env, logger = null) {
  const warnings = collectStartupWarnings(env);
  if (warnings.length === 0) return warnings;

  console.warn('\n──────────────────────────────────────────────────────────────');
  console.warn(` Paperweight startup warnings (${warnings.length}):`);
  console.warn('──────────────────────────────────────────────────────────────');
  for (const w of warnings) {
    console.warn(`  ⚠ ${w}`);
    if (typeof logger === 'function') {
      try { logger('warn', 'server', w); } catch { /* logging must never break boot */ }
    }
  }
  console.warn('──────────────────────────────────────────────────────────────\n');
  return warnings;
}

module.exports = { collectStartupWarnings, printStartupWarnings };
