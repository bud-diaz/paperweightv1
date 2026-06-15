const router = require('express').Router();
const { getDb } = require('../db');
const { requireDashboard } = require('../auth/middleware');

let _version;
function getVersion() {
  if (!_version) {
    try { _version = require('../../package.json').version; } catch { _version = 'unknown'; }
  }
  return _version;
}

router.use(requireDashboard);

// GET /api/system/launch-status - dashboard-only, checked after creator login
router.get('/launch-status', (req, res) => {
  const row = getDb().prepare('SELECT accepted_at, version FROM launch_acceptance WHERE id = 1').get();
  const accepted = !!(row && row.accepted_at);
  res.json({ accepted, acceptedAt: row ? row.accepted_at : null });
});

// POST /api/system/launch-accept - records creator acceptance
router.post('/launch-accept', (req, res) => {
  getDb().prepare(`
    UPDATE launch_acceptance
    SET accepted_at = datetime('now'), version = ?
    WHERE id = 1
  `).run(getVersion());
  res.json({ ok: true });
});

module.exports = router;
