const router = require('express').Router();
const crypto = require('crypto');
const broadcast = require('../broadcast');
const live = require('../broadcast/live');
const ascilineManager = require('../broadcast/asciline');
const { getDb, log } = require('../db');

// In-memory listener sessions keyed by anonymous listener hash.
// Sessions expire after 60s with no ping.
const activeListeners = new Map();
const LISTENER_TTL_MS = 60_000;
const MAX_PING_DELTA_SEC = 45;
const DAILY_STATS_REFRESH_MS = 60_000;
let lastDailyStatsRefreshMs = 0;

function listenerHash(req) {
  const raw = req.ip || req.socket?.remoteAddress || '';
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function pruneExpired(nowMs = Date.now()) {
  const cutoff = nowMs - LISTENER_TTL_MS;
  for (const [hash, session] of activeListeners) {
    if ((session.lastPingMs || 0) < cutoff) activeListeners.delete(hash);
  }
}

function getListenerCount() {
  pruneExpired();
  return activeListeners.size;
}

function todaySqlDate() {
  return new Date().toISOString().slice(0, 10);
}

function refreshDailyStats(date = todaySqlDate()) {
  const db = getDb();
  const start = `${date} 00:00:00`;
  const end = `${date} 23:59:59`;

  const totals = db.prepare(`
    SELECT
      COUNT(DISTINCT ip_hash) AS unique_listeners,
      COALESCE(SUM(seconds), 0) AS total_listen_sec
    FROM listen_events
    WHERE started_at BETWEEN ? AND ?
  `).get(start, end);

  const top = db.prepare(`
    SELECT media_id
    FROM listen_events
    WHERE started_at BETWEEN ? AND ? AND media_id IS NOT NULL
    GROUP BY media_id
    ORDER BY SUM(seconds) DESC, COUNT(*) DESC
    LIMIT 1
  `).get(start, end);

  db.prepare(`
    INSERT INTO daily_stats (date, unique_listeners, total_listen_sec, top_media_id)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(date) DO UPDATE SET
      unique_listeners = excluded.unique_listeners,
      total_listen_sec = excluded.total_listen_sec,
      top_media_id = excluded.top_media_id
  `).run(date, totals.unique_listeners || 0, totals.total_listen_sec || 0, top?.media_id || null);
}

function maybeRefreshDailyStats(nowMs) {
  if (nowMs - lastDailyStatsRefreshMs < DAILY_STATS_REFRESH_MS) return;
  lastDailyStatsRefreshMs = nowMs;
  refreshDailyStats();
}

function recordListenEvent(req, state, nowMs) {
  const mediaId = state?.nowPlaying?.id;
  if (!mediaId) return null;

  const db = getDb();
  const hash = listenerHash(req);
  const existing = activeListeners.get(hash);

  if (existing?.mediaId === mediaId && existing.eventId) {
    const deltaSec = Math.max(
      1,
      Math.min(MAX_PING_DELTA_SEC, Math.round((nowMs - existing.lastPingMs) / 1000) || 1)
    );

    db.prepare('UPDATE listen_events SET seconds = seconds + ? WHERE id = ?')
      .run(deltaSec, existing.eventId);
    existing.lastPingMs = nowMs;
    existing.lastMediaStartedAt = state.nowPlaying.startedAt || null;
    activeListeners.set(hash, existing);
    return { eventId: existing.eventId, secondsDelta: deltaSec };
  }

  const info = db.prepare(
    'INSERT INTO listen_events (ip_hash, media_id, seconds, tier) VALUES (?, ?, ?, ?)'
  ).run(hash, mediaId, 0, req.tier || 'free');

  activeListeners.set(hash, {
    mediaId,
    eventId: info.lastInsertRowid,
    lastPingMs: nowMs,
    lastMediaStartedAt: state.nowPlaying.startedAt || null,
  });

  return { eventId: info.lastInsertRowid, secondsDelta: 0 };
}

function recordPing(req) {
  const nowMs = Date.now();
  const hash = listenerHash(req);
  pruneExpired(nowMs);

  const state = broadcast.getState();
  try {
    const event = recordListenEvent(req, state, nowMs);
    if (event?.eventId && event.secondsDelta > 0) {
      maybeRefreshDailyStats(nowMs);
    } else if (!event?.eventId) {
      const session = activeListeners.get(hash) || {};
      session.lastPingMs = nowMs;
      activeListeners.set(hash, session);
    }
  } catch (err) {
    log('warn', 'analytics', `Failed to record listen event: ${err.message}`);
  }

  return activeListeners.size;
}

router.get('/status', (req, res) => {
  const state = broadcast.getState();
  const liveState = live.getLiveState();
  const { enabled, running, port, mode } = ascilineManager.getStatus();
  res.json({
    ...state,
    liveActive: liveState.isLive,
    liveStartedAt: liveState.startedAt,
    listenerCount: getListenerCount(),
    asciline: { enabled, running, port, mode },
  });
});

// Web player calls this every 30s to register as an active listener.
router.post('/ping', (req, res) => {
  const count = recordPing(req);
  res.json({ listenerCount: count });
});

module.exports = router;
module.exports.getListenerCount = getListenerCount;
module.exports.refreshDailyStats = refreshDailyStats;
module.exports.recordPing = recordPing;
