const crypto = require('crypto');
const { getDb } = require('../db');
const { isSubscriberTier } = require('../auth/access');

const HOUR_MS = 60 * 60 * 1000;
const DEDUPE_MS = 5 * 60 * 1000;
const ANON_LIMIT = 3;
const FREE_TOKEN_LIMIT = 5;

const buckets = new Map();

function hashIp(req) {
  const raw = req.ip || req.socket?.remoteAddress || '';
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function quotaKey(req) {
  // Prefer the listener account id so the budget is shared across a
  // listener's devices/tokens; fall back to the token id for creator-issued
  // tokens that have no account.
  if (req.tokenRow?.id) return `listener:${req.tokenRow.listener_id || req.tokenRow.id}`;
  return `ip:${hashIp(req)}`;
}

// The free-token allowance is reserved for listeners who shared an email:
// account-backed tokens always qualify (listener_accounts.email is NOT NULL),
// legacy profile-only tokens qualify only when the profile captured one.
function hasEmailIdentity(req) {
  if (req._hasEmailIdentity !== undefined) return req._hasEmailIdentity;
  let has = false;
  if (req.tokenRow) {
    if (req.tokenRow.listener_id) {
      has = true;
    } else {
      try {
        const profile = getDb().prepare(
          'SELECT email FROM listener_profiles WHERE token_id = ?'
        ).get(req.tokenRow.id);
        has = !!(profile && profile.email);
      } catch {
        has = true; // fail open: a DB hiccup should not shrink the quota
      }
    }
  }
  req._hasEmailIdentity = has;
  return has;
}

function quotaLimit(req) {
  if (isSubscriberTier(req.tier)) return Infinity;
  return hasEmailIdentity(req) ? FREE_TOKEN_LIMIT : ANON_LIMIT;
}

function bucketFor(key) {
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { plays: [], recent: new Map(), nextUpTs: 0 };
    buckets.set(key, bucket);
  }
  return bucket;
}

function prune(bucket, nowMs) {
  const cutoff = nowMs - HOUR_MS;
  bucket.plays = bucket.plays.filter(play => play.ts > cutoff);

  const recentCutoff = nowMs - DEDUPE_MS;
  for (const [mediaId, ts] of bucket.recent) {
    if (ts <= recentCutoff) bucket.recent.delete(mediaId);
  }

  if (bucket.nextUpTs && bucket.nextUpTs <= cutoff) {
    bucket.nextUpTs = 0;
  }
}

function resetSecFor(bucket, nowMs) {
  const oldest = bucket.plays[0];
  if (!oldest) return 0;
  return Math.max(1, Math.ceil((oldest.ts + HOUR_MS - nowMs) / 1000));
}

function snapshot(req, nowMs = Date.now()) {
  const limit = quotaLimit(req);
  if (limit === Infinity) {
    return { limit: null, remaining: null, resetSec: 0, unlimited: true };
  }

  const bucket = bucketFor(quotaKey(req));
  prune(bucket, nowMs);
  const remaining = Math.max(0, limit - bucket.plays.length);
  const out = {
    limit,
    remaining,
    resetSec: remaining > 0 ? 0 : resetSecFor(bucket, nowMs),
    // Whether the one deferred "next up after the current broadcast track"
    // play is still unspent this hour — the client uses it to stop offering
    // the slot instead of arming a pick that would 429 when it fires.
    nextUpAvailable: !bucket.nextUpTs,
  };
  // Token holders stuck on the anonymous limit can raise it by adding an
  // email; the client uses this flag to say so.
  if (req.tokenRow && !hasEmailIdentity(req)) out.emailRequired = true;
  return out;
}

function checkAndRecordPlay(req, mediaId, { nextUp = false } = {}) {
  const nowMs = Date.now();
  const limit = quotaLimit(req);
  if (limit === Infinity) {
    return { allowed: true, limit: null, remaining: null, resetSec: 0, unlimited: true };
  }

  const bucket = bucketFor(quotaKey(req));
  prune(bucket, nowMs);

  const mediaKey = String(mediaId);
  const recentTs = bucket.recent.get(mediaKey);
  if (recentTs && nowMs - recentTs < DEDUPE_MS) {
    return { allowed: true, ...snapshot(req, nowMs), deduped: true };
  }

  if (bucket.plays.length < limit) {
    bucket.plays.push({ mediaId: mediaKey, ts: nowMs });
    bucket.recent.set(mediaKey, nowMs);
    return { allowed: true, ...snapshot(req, nowMs) };
  }

  if (nextUp && !bucket.nextUpTs) {
    bucket.nextUpTs = nowMs;
    bucket.recent.set(mediaKey, nowMs);
    return { allowed: true, ...snapshot(req, nowMs), nextUpBonus: true };
  }

  return { allowed: false, limit, remaining: 0, resetSec: resetSecFor(bucket, nowMs) };
}

function quotaStatus(req) {
  return snapshot(req);
}

function _reset() {
  buckets.clear();
}

module.exports = { checkAndRecordPlay, quotaStatus, _reset };
