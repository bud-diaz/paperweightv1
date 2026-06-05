const router = require('express').Router();
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { getDb } = require('../db');
const { canDownloadMedia } = require('../auth/access');

const TOKEN_TTL_HOURS = parseInt(process.env.DOWNLOAD_TOKEN_TTL_HOURS || '48', 10);

function getProjectId(db, mediaId) {
  const row = db.prepare(
    'SELECT project_id FROM vault_project_items WHERE content_id = ?'
  ).get(mediaId);
  return row?.project_id ?? null;
}

// Legacy signed-token download flow. The newer /api/library/:id/download route
// returns HMAC links; keep this route aligned with the same access policy.
router.get('/library/:id/signed-url', (req, res) => {
  const db = getDb();

  const media = db.prepare(
    'SELECT id, filename, filepath, title, visibility FROM media WHERE id = ? AND is_active = 1'
  ).get(req.params.id);

  if (!media) {
    return res.status(404).json({ error: 'Media not found' });
  }

  const access = canDownloadMedia(req, media, getProjectId(db, media.id));
  if (!access.allowed) {
    return res.status(403).json({ error: access.error, unlockOptions: access.unlockOptions });
  }

  if (!req.tokenRow?.listener_id) {
    return res.status(401).json({ error: 'Listener account required for signed download tokens' });
  }

  if (!fs.existsSync(media.filepath)) {
    return res.status(404).json({ error: 'File not found on disk' });
  }

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + TOKEN_TTL_HOURS * 60 * 60 * 1000).toISOString();

  db.prepare(
    'INSERT INTO download_tokens (media_id, listener_id, token, expires_at) VALUES (?, ?, ?, ?)'
  ).run(media.id, req.tokenRow.listener_id, token, expiresAt);

  res.json({
    signedUrl: `/api/download/${token}`,
    expiresAt,
    filename: path.basename(media.filepath),
    title: media.title || media.filename,
  });
});

router.get('/download/:token', (req, res) => {
  const { token } = req.params;

  if (!token || typeof token !== 'string' || token.length !== 64) {
    return res.status(400).json({ error: 'Invalid token' });
  }

  const record = getDb().prepare(
    'SELECT dt.*, m.filepath, m.filename, m.title FROM download_tokens dt JOIN media m ON m.id = dt.media_id WHERE dt.token = ?'
  ).get(token);

  if (!record) {
    return res.status(404).json({ error: 'Token not found' });
  }

  if (new Date(record.expires_at) < new Date()) {
    return res.status(403).json({ error: 'Download token has expired', expiresAt: record.expires_at });
  }

  if (!fs.existsSync(record.filepath)) {
    return res.status(404).json({ error: 'File not found on disk' });
  }

  res.download(record.filepath, path.basename(record.filepath));
});

module.exports = router;
