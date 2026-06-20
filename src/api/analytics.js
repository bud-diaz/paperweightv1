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

// GET /api/analytics/subscribers?days=90
router.get('/subscribers', (req, res) => {
  const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 90));
  const db = getDb();

  const newRows = db.prepare(`
    SELECT
      date(created_at) AS date,
      COUNT(*) AS new_subscribers
    FROM subscriptions
    WHERE created_at >= date('now', :offset)
    GROUP BY date(created_at)
    ORDER BY date ASC
  `).all({ offset: `-${days} days` });

  const activeRows = db.prepare(`
    SELECT COUNT(*) AS active_total
    FROM subscriptions
    WHERE status = 'active'
      AND datetime(current_period_end) > datetime('now')
  `).get();

  const newByDate = new Map(newRows.map(r => [r.date, r.new_subscribers]));
  const rows = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date();
    day.setDate(day.getDate() - i);
    const date = day.toISOString().slice(0, 10);
    const { active_total } = db.prepare(`
      SELECT COUNT(*) AS active_total
      FROM subscriptions
      WHERE status = 'active'
        AND date(created_at) <= :date
        AND datetime(current_period_end) > datetime(:date || ' 23:59:59')
    `).get({ date });
    rows.push({
      date,
      new_subscribers: newByDate.get(date) || 0,
      active_total,
    });
  }

  res.json({
    activeTotal: activeRows.active_total || 0,
    rows,
    history: rows.map(r => ({
      date: r.date,
      newSubscribers: r.new_subscribers,
      activeTotal: r.active_total,
    })),
  });
});

// GET /api/analytics/playcounts — all-time play count per media id
router.get('/playcounts', (req, res) => {
  const rows = getDb().prepare(`
    SELECT media_id, COUNT(*) AS plays
    FROM listen_events
    WHERE media_id IS NOT NULL
    GROUP BY media_id
  `).all();

  const map = {};
  for (const r of rows) map[r.media_id] = r.plays;
  res.json(map);
});

module.exports = router;
