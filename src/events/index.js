'use strict';

// First-party audience activity. Writes are deliberately best-effort: insight
// bookkeeping must never interrupt playback, publishing, or payment handling.

const { getDb, log } = require('../db');

const EVENT_TYPES = new Set([
  'profile_created',
  'broadcast_started',
  'live_broadcast_started',
  'live_broadcast_ended',
  'on_demand_started',
  'on_demand_completed',
  'preview_started',
  'post_viewed',
  'vault_gate_viewed',
  'checkout_started',
  'unlock_completed',
  'tip_completed',
  'subscription_started',
  'subscription_renewed',
  'subscription_cancelled',
  'subscription_expired',
  'offline_saved',
  'share_opened',
  'release_published',
  'request_submitted',
  'poll_voted',
  'premiere_reminder_requested',
  'creator_action_completed',
]);

const CLIENT_EVENT_TYPES = new Set([
  'on_demand_started',
  'on_demand_completed',
  'preview_started',
  'post_viewed',
  'vault_gate_viewed',
  'offline_saved',
]);

const SOURCES = new Set([
  'broadcast', 'library', 'discover', 'collection', 'post', 'share',
  'offline', 'release', 'checkout', 'webhook', 'dashboard', 'participation',
]);

function asPositiveInt(value) {
  const number = Number.parseInt(value, 10);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function safeMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const allowed = {};
  for (const [key, raw] of Object.entries(value).slice(0, 12)) {
    if (!/^[a-z][a-z0-9_]{0,39}$/i.test(key)) continue;
    if (typeof raw === 'string') allowed[key] = raw.slice(0, 240);
    else if (typeof raw === 'number' && Number.isFinite(raw)) allowed[key] = raw;
    else if (typeof raw === 'boolean' || raw === null) allowed[key] = raw;
  }
  return Object.keys(allowed).length ? JSON.stringify(allowed) : null;
}

function identityForToken(db, tokenRow) {
  if (!tokenRow) return { profileId: null, listenerId: null };
  const listenerId = asPositiveInt(tokenRow.listener_id);
  let profile = null;
  if (listenerId) {
    profile = db.prepare(
      'SELECT id FROM listener_profiles WHERE account_id = ? ORDER BY created_at DESC LIMIT 1'
    ).get(listenerId);
  }
  if (!profile) {
    profile = db.prepare(
      'SELECT id FROM listener_profiles WHERE token_id = ? ORDER BY created_at DESC LIMIT 1'
    ).get(tokenRow.id);
  }
  return { profileId: profile?.id || null, listenerId };
}

function identityForRequest(req, db = getDb()) {
  return identityForToken(db, req?.tokenRow);
}

function recordAudienceEvent(eventType, input = {}) {
  if (!EVENT_TYPES.has(eventType)) return null;
  try {
    const db = input.db || getDb();
    const identity = input.req
      ? identityForRequest(input.req, db)
      : {
          profileId: asPositiveInt(input.profileId),
          listenerId: asPositiveInt(input.listenerId),
        };
    const source = SOURCES.has(input.source) ? input.source : null;
    const valueCents = Number.isSafeInteger(input.valueCents) && input.valueCents >= 0
      ? input.valueCents
      : null;
    const currency = typeof input.currency === 'string'
      ? input.currency.trim().toLowerCase().slice(0, 8)
      : null;
    const info = db.prepare(`
      INSERT OR IGNORE INTO audience_events (
        event_type, profile_id, listener_id, media_id, project_id, post_id,
        source, value_cents, currency, dedupe_key, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      eventType,
      identity.profileId,
      identity.listenerId,
      asPositiveInt(input.mediaId),
      asPositiveInt(input.projectId),
      asPositiveInt(input.postId),
      source,
      valueCents,
      currency,
      input.dedupeKey ? String(input.dedupeKey).slice(0, 200) : null,
      safeMetadata(input.metadata)
    );
    const eventId = info.changes ? Number(info.lastInsertRowid) : null;
    if (eventId) {
      try {
        require('../jobs/runner').enqueue('automation.evaluate', { eventId }, {
          dedupeKey: `automation:event:${eventId}`,
          maxAttempts: 3,
        });
      } catch {}
    }
    return eventId;
  } catch (err) {
    try { log('warn', 'audience-events', `Could not record ${eventType}: ${err.message}`); } catch {}
    return null;
  }
}

function recordSubscriptionEvent(db, input) {
  try {
    const listenerId = asPositiveInt(input.listenerId);
    if (!listenerId || !input.provider || !input.eventType) return null;
    const info = db.prepare(`
      INSERT OR IGNORE INTO subscription_events (
        subscription_id, listener_id, event_type, tier, status, amount_cents,
        currency, billing_interval, provider, provider_event_id,
        provider_subscription_id, dedupe_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      asPositiveInt(input.subscriptionId), listenerId, String(input.eventType),
      input.tier || null, input.status || null,
      Number.isSafeInteger(input.amountCents) ? input.amountCents : null,
      input.currency ? String(input.currency).toLowerCase().slice(0, 8) : null,
      input.billingInterval || null, String(input.provider),
      input.providerEventId || null, input.providerSubscriptionId || null,
      input.dedupeKey || null
    );
    return info.changes ? Number(info.lastInsertRowid) : null;
  } catch (err) {
    try { log('warn', 'subscription-events', `Could not record lifecycle event: ${err.message}`); } catch {}
    return null;
  }
}

module.exports = {
  EVENT_TYPES,
  CLIENT_EVENT_TYPES,
  identityForRequest,
  identityForToken,
  recordAudienceEvent,
  recordSubscriptionEvent,
};
