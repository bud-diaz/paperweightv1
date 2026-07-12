const crypto = require('crypto');
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
  if (req.tokenRow?.id) return `listener:${req.tokenRow.id}`;
  return `ip:${hashIp(req)}`;
}

function quotaLimit(req) {
  if (isSubscriberTier(req.tier)) return Infinity;
  return req.tokenRow ? FREE_TOKEN_LIMIT : ANON_LIMIT;
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
  return {
    limit,
    remaining,
    resetSec: remaining > 0 ? 0 : resetSecFor(bucket, nowMs),
  };
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
