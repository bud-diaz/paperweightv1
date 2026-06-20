const router = require('express').Router();
const { getDb } = require('../db');
const { requireDashboard } = require('../auth/middleware');
const { isDesktop } = require('../auth/platform');

let _version;
function getVersion() {
  if (!_version) {
    try { _version = require('../../package.json').version; } catch { _version = 'unknown'; }
  }
  return _version;
}

// GET /api/system/launch-status — dashboard-auth required; modal is shown
// after showDashContent() so the session cookie is always present.
router.get('/launch-status', requireDashboard, (req, res) => {
  const row = getDb().prepare('SELECT accepted_at, version FROM launch_acceptance WHERE id = 1').get();
  const accepted = !!(row && row.accepted_at);
  res.json({ accepted, acceptedAt: row ? row.accepted_at : null });
});

// POST /api/system/launch-accept — records acceptance, dashboard-auth required.
router.post('/launch-accept', requireDashboard, (req, res) => {
  getDb().prepare(`
    UPDATE launch_acceptance
    SET accepted_at = datetime('now'), version = ?
    WHERE id = 1
  `).run(getVersion());
  res.json({ ok: true });
});

// GET /api/system/platform — tells the dashboard whether to show desktop-only
// panels (smart playlists, external search/import, token assignment).
router.get('/platform', requireDashboard, (req, res) => {
  res.json({ platform: isDesktop() ? 'desktop' : 'web' });
});

module.exports = router;
