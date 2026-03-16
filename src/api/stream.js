const router = require('express').Router();
const crypto = require('crypto');
const broadcast = require('../broadcast');

// In-memory listener tracking: ipHash → lastPingMs
// Listeners expire after 60s with no ping.
const activeListeners = new Map();
const LISTENER_TTL_MS = 60_000;

function recordPing(ip) {
  const hash = crypto.createHash('sha256').update(ip || '').digest('hex');
  activeListeners.set(hash, Date.now());

  // Prune expired entries
  const cutoff = Date.now() - LISTENER_TTL_MS;
  for (const [k, v] of activeListeners) {
    if (v < cutoff) activeListeners.delete(k);
  }
  return activeListeners.size;
}

function getListenerCount() {
  const cutoff = Date.now() - LISTENER_TTL_MS;
  let count = 0;
  for (const v of activeListeners.values()) {
    if (v >= cutoff) count++;
  }
  return count;
}

// GET /api/stream/status
router.get('/status', (req, res) => {
  const state = broadcast.getState();
  res.json({
    ...state,
    listenerCount: getListenerCount(),
  });
});

// POST /api/stream/ping
// Web player calls this every 30s to register as an active listener.
router.post('/ping', (req, res) => {
  const count = recordPing(req.ip);
  res.json({ listenerCount: count });
});

module.exports = router;
module.exports.getListenerCount = getListenerCount;
