const router = require('express').Router();
const { getDb } = require('../db');
const { requireDashboard } = require('../auth/middleware');
const { getListenerCount } = require('./stream');

router.use(requireDashboard);

// GET /api/analytics/live
router.get('/live', (req, res) => {
  const db = getDb();

  const today = new Date().toISOString().slice(0, 10);
  const todayPeak = db.prepare(`
    SELECT COUNT(DISTINCT ip_hash) AS peak
    FROM listen_events
    WHERE started_at >= :today
  `).get({ today: today + ' 00:00:00' });

  res.json({
    currentListeners: getListenerCount(),
    peakToday: todayPeak.peak || 0,
  });
});

// GET /api/analytics/history?days=30
router.get('/history', (req, res) => {
  const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30));

  const rows = getDb().prepare(`
    SELECT date, unique_listeners, total_listen_sec, top_media_id
    FROM daily_stats
    WHERE date >= date('now', :offset)
    ORDER BY date ASC
  `).all({ offset: `-${days} days` });

  res.json(rows);
});

// GET /api/analytics/top?limit=10&period=7d
router.get('/top', (req, res) => {
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
  const period = req.query.period || '7d';

  // Parse period string: '7d', '30d', '90d'
  const days = parseInt(period, 10) || 7;

  const rows = getDb().prepare(`
    SELECT
      m.id, m.title, m.filename, m.artist, m.category, m.duration,
      COUNT(le.id) AS play_count,
      SUM(le.seconds) AS total_seconds
    FROM listen_events le
    JOIN media m ON m.id = le.media_id
    WHERE le.started_at >= datetime('now', :offset)
    GROUP BY le.media_id
    ORDER BY total_seconds DESC
    LIMIT :limit
  `).all({ offset: `-${days} days`, limit });

  res.json(rows);
});

module.exports = router;
