const router = require('express').Router();
const { getDb } = require('../db');

let _version;
function getVersion() {
  if (!_version) {
    try { _version = require('../../package.json').version; } catch { _version = 'unknown'; }
  }
  return _version;
}

// GET /api/system/launch-status — no auth, checked on creator first load
router.get('/launch-status', (req, res) => {
  const row = getDb().prepare('SELECT accepted_at, version FROM launch_acceptance WHERE id = 1').get();
  const accepted = !!(row && row.accepted_at);
  res.json({ accepted, acceptedAt: row ? row.accepted_at : null });
});

// POST /api/system/launch-accept — records acceptance
router.post('/launch-accept', (req, res) => {
  getDb().prepare(`
    UPDATE launch_acceptance
    SET accepted_at = datetime('now'), version = ?
    WHERE id = 1
  `).run(getVersion());
  res.json({ ok: true });
});

module.exports = router;
