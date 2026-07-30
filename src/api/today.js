'use strict';

const router = require('express').Router();
const { requireDashboard } = require('../auth/middleware');
const { getDb } = require('../db');
const { getToday } = require('../insights/engine');
const { recordAudienceEvent } = require('../events');
const { toSqliteDatetime } = require('../runtime/datetime');

router.use(requireDashboard);

router.get('/', (req, res) => res.json(getToday()));

router.post('/state', (req, res) => {
  const key = typeof req.body?.key === 'string' ? req.body.key.slice(0, 200) : '';
  const status = req.body?.status;
  if (!key || !['active', 'dismissed', 'snoozed', 'completed'].includes(status)) {
    return res.status(400).json({ error: 'Invalid insight state' });
  }
  let until = null;
  if (status === 'snoozed') {
    const days = Math.min(90, Math.max(1, Number.parseInt(req.body.days, 10) || 7));
    until = toSqliteDatetime(new Date(Date.now() + days * 86400000));
  }
  getDb().prepare(`
    INSERT INTO insight_state (insight_key, status, dismissed_until)
    VALUES (?, ?, ?)
    ON CONFLICT(insight_key) DO UPDATE SET status = excluded.status,
      dismissed_until = excluded.dismissed_until, last_seen_at = datetime('now')
  `).run(key, status, until);
  if (status === 'completed') {
    recordAudienceEvent('creator_action_completed', { source: 'dashboard', dedupeKey: `insight:${key}:completed` });
  }
  res.json({ ok: true, key, status, dismissedUntil: until });
});

module.exports = router;
