const router = require('express').Router();
const { requireDashboard } = require('../auth/middleware');
const ascilineManager = require('../broadcast/asciline');

// Public — checked by the player to decide whether to show the ASCII mode button
router.get('/status', (req, res) => {
  const { enabled, running, port, mode } = ascilineManager.getStatus();
  res.json({ enabled, running, port, mode });
});

router.post('/dashboard/start', requireDashboard, (req, res) => {
  ascilineManager.start();
  res.json({ ok: true, status: ascilineManager.getStatus() });
});

router.post('/dashboard/stop', requireDashboard, (req, res) => {
  ascilineManager.stop();
  res.json({ ok: true });
});

module.exports = router;
