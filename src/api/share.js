const router = require('express').Router();
const crypto = require('crypto');
const { getDb, log } = require('../db');
const { requireDashboard } = require('../auth/middleware');
const { formatItem, signDownloadUrl } = require('./library');
const asyncHandler = require('../middleware/asyncHandler');

const dashRouter = require('express').Router();

function generateToken() {
  return crypto.randomBytes(24).toString('hex');
}

function publicShareUrl(req, token) {
  return `${req.protocol}://${req.get('host')}/share/${token}`;
}

function isExpired(row) {
  return !!row.expires_at && new Date(row.expires_at).getTime() < Date.now();
}

// Builds the public-facing payload for a track row: same shape as
// formatItem, but the tier-gated downloadUrl is replaced with an
// unauthenticated signed stream URL since the token is the credential.
function buildTrackPayload(row) {
  const item = formatItem(row, 'free');
  delete item.downloadUrl;
  item.streamUrl = signDownloadUrl(row.id).signedUrl;
  return item;
}

function buildSharePayload(db, row) {
  if (row.target_type === 'track') {
    const media = db.prepare('SELECT * FROM media WHERE id = ? AND is_active = 1').get(row.target_id);
    if (!media) return null;
    return { target_type: 'track', track: buildTrackPayload(media) };
  }

  const project = db.prepare('SELECT * FROM vault_projects WHERE id = ?').get(row.target_id);
  if (!project) return null;

  const items = db.prepare(
    `SELECT m.* FROM vault_project_items vpi
     JOIN media m ON m.id = vpi.content_id AND m.is_active = 1
     WHERE vpi.project_id = ?
     ORDER BY m.indexed_at ASC`
  ).all(row.target_id);

  const projectPayload = {
    target_type: 'project',
    project: {
      id: project.id,
      name: project.name,
      description: project.description || null,
      tracks: items.map(buildTrackPayload),
    },
  };
  projectPayload.collection = projectPayload.project;
  return projectPayload;
}

// ── Public resolve route ────────────────────────────────────────────────────
router.get('/:token', asyncHandler(async (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM share_links WHERE token = ?').get(req.params.token);

  if (!row || isExpired(row)) {
    return res.status(404).json({ error: 'Link not found or expired' });
  }

  const payload = buildSharePayload(db, row);
  if (!payload) {
    return res.status(404).json({ error: 'Shared content no longer available' });
  }

  db.prepare(
    "UPDATE share_links SET open_count = open_count + 1, last_opened_at = datetime('now') WHERE id = ?"
  ).run(row.id);

  res.json({
    label: row.label || null,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    ...payload,
  });
}));

// ── Dashboard management routes ─────────────────────────────────────────────
dashRouter.use(requireDashboard);

dashRouter.post('/', asyncHandler(async (req, res) => {
  const { target_type, target_id, label, expires_in_hours } = req.body || {};

  if (target_type !== 'track' && target_type !== 'project') {
    return res.status(400).json({ error: 'target_type must be "track" or "project"' });
  }
  const targetId = parseInt(target_id, 10);
  if (!Number.isInteger(targetId)) {
    return res.status(400).json({ error: 'target_id must be an integer' });
  }

  const db = getDb();
  const table = target_type === 'track' ? 'media' : 'vault_projects';
  const idCol = target_type === 'track' ? 'id' : 'id';
  const exists = db.prepare(`SELECT ${idCol} FROM ${table} WHERE ${idCol} = ?`).get(targetId);
  if (!exists) {
    return res.status(404).json({ error: 'Target not found' });
  }

  let expiresAt = null;
  if (expires_in_hours != null && expires_in_hours !== '') {
    const hours = parseFloat(expires_in_hours);
    if (!Number.isFinite(hours) || hours <= 0) {
      return res.status(400).json({ error: 'expires_in_hours must be a positive number' });
    }
    expiresAt = new Date(Date.now() + hours * 3600 * 1000).toISOString();
  }

  const token = generateToken();
  db.prepare(
    'INSERT INTO share_links (token, target_type, target_id, label, expires_at) VALUES (?, ?, ?, ?, ?)'
  ).run(token, target_type, targetId, label || null, expiresAt);

  const row = db.prepare('SELECT * FROM share_links WHERE token = ?').get(token);
  log('info', 'share', `Created share link for ${target_type}:${targetId}`);
  res.status(201).json({
    ...row,
    url: publicShareUrl(req, token),
    expiresAt: row.expires_at,
  });
}));

dashRouter.get('/', (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM share_links ORDER BY created_at DESC').all();

  const labeled = rows.map(row => {
    let targetLabel = null;
    if (row.target_type === 'track') {
      const m = db.prepare('SELECT title, filename FROM media WHERE id = ?').get(row.target_id);
      targetLabel = m ? (m.title || m.filename) : null;
    } else {
      const p = db.prepare('SELECT name FROM vault_projects WHERE id = ?').get(row.target_id);
      targetLabel = p ? p.name : null;
    }
    return { ...row, target_label: targetLabel };
  });

  res.json(labeled);
});

dashRouter.delete('/:token', (req, res) => {
  const db = getDb();
  const result = db.prepare('DELETE FROM share_links WHERE token = ?').run(req.params.token);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Link not found' });
  }
  res.json({ success: true });
});

module.exports = router;
module.exports.dashRouter = dashRouter;
