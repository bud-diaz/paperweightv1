'use strict';

const router = require('express').Router();
const { requireDashboard } = require('../auth/middleware');
const { getDb } = require('../db');
const { setSetting } = require('../db/settings');
const asyncHandler = require('../middleware/asyncHandler');
const ops = require('../ops');

router.use(requireDashboard);
router.get('/', (req, res) => res.json(ops.status()));
router.post('/check', (req, res) => { ops.runChecks(); res.json(ops.status()); });
router.post('/backup', asyncHandler(async (req, res) => res.status(201).json(await ops.createBackup())));
router.post('/backup/:id/verify', asyncHandler(async (req, res) => {
  await ops.verifyBackup(Number(req.params.id));
  res.json({ ok: true });
}));
router.get('/history', (req, res) => {
  const days = Math.min(90, Math.max(1, Number.parseInt(req.query.days, 10) || 30));
  const rows = getDb().prepare("SELECT * FROM ops_checks WHERE checked_at >= datetime('now', ?) ORDER BY checked_at DESC LIMIT 2000").all(`-${days} days`);
  res.json({ days, checks: rows });
});
router.put('/settings', (req, res) => {
  setSetting('ops_auto_backup', req.body?.autoBackup ? '1' : '0');
  res.json({ ok: true, autoBackup: !!req.body?.autoBackup });
});

module.exports = router;
