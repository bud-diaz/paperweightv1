// Outbound notifications: a creator-configured webhook (Discord-compatible
// JSON: { content, username }) fired on go-live and new posts, plus optional
// per-post email to active supporters when SMTP is configured.
//
// Everything here is best-effort and fire-and-forget: a dead webhook or SMTP
// hiccup must never break going live or publishing a post.

const { getDb, log } = require('../db');
const { getSetting, getBoolSetting } = require('../db/settings');
const { isEmailConfigured, sendMail } = require('../email');
const { resolvesToBlockedAddress } = require('../runtime/net-guard');
const config = require('../config');

const WEBHOOK_TIMEOUT_MS = 10_000;

function stationUrl() {
  return config.station.publicUrl || `http://localhost:${config.port}`;
}

function stationName() {
  return config.station.name || 'Paperweight';
}

// POSTs { content, username } to the configured webhook URL. Refuses URLs that
// resolve to private/reserved addresses so the owner-set value can't be used
// to probe the server's own network.
async function postWebhook(content) {
  const url = getSetting('notify_webhook_url');
  if (!url) return false;

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    log('warn', 'notify', 'notify_webhook_url is not a valid URL');
    return false;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    log('warn', 'notify', `notify_webhook_url has unsupported protocol ${parsed.protocol}`);
    return false;
  }
  if (await resolvesToBlockedAddress(parsed.hostname)) {
    log('warn', 'notify', 'notify_webhook_url resolves to a private or reserved address; not sending');
    return false;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, username: stationName() }),
    signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`webhook responded HTTP ${res.status}`);
  return true;
}

function fireWebhook(content, context) {
  setImmediate(() => {
    postWebhook(content).catch(err => {
      log('warn', 'notify', `${context} webhook failed: ${err.message}`);
    });
  });
}

// Called when the creator starts a live mic broadcast.
function liveStarted() {
  if (!getBoolSetting('notify_live_enabled', true)) return;
  fireWebhook(`🔴 ${stationName()} is live now — listen at ${stationUrl()}`, 'go-live');
}

// Emails of listeners with an active subscription (the audience that opted into
// a relationship with this station). Pending Stripe placeholders are excluded.
function supporterEmails(db) {
  return db.prepare(`
    SELECT DISTINCT la.email FROM listener_accounts la
    JOIN subscriptions s ON s.listener_id = la.id AND s.status = 'active'
    WHERE la.is_active = 1
      AND la.email NOT LIKE '%@pending.paperweight.local'
      AND la.email NOT LIKE 'deleted-%@account.invalid'
  `).all().map(r => r.email);
}

// Called after a post is published. Always announces on the webhook (title
// only — the post body may be supporters-only); optionally emails the full
// post to active supporters when the creator asked for it.
function postPublished(post, { emailSupporters = false } = {}) {
  const title = post.title || 'New post';
  fireWebhook(`📝 ${stationName()} posted: ${title} — ${stationUrl()}`, 'post');

  if (!emailSupporters) return;
  if (!isEmailConfigured()) {
    log('warn', 'notify', 'Post email notification requested but SMTP is not configured');
    return;
  }

  const emails = supporterEmails(getDb());
  if (!emails.length) return;

  setImmediate(async () => {
    let sent = 0;
    for (const to of emails) {
      try {
        await sendMail({
          to,
          subject: `${stationName()}: ${title}`,
          text: [
            post.title || '',
            post.title ? '' : null,
            post.body,
            '',
            `— ${stationName()}`,
            stationUrl(),
          ].filter(line => line !== null).join('\n'),
        });
        sent++;
      } catch (err) {
        log('warn', 'notify', `Post email to a supporter failed: ${err.message}`);
      }
    }
    log('info', 'notify', `Post "${title}" emailed to ${sent}/${emails.length} supporters`);
  });
}

module.exports = { liveStarted, postPublished, postWebhook, supporterEmails };
