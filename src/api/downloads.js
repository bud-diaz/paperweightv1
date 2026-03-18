const router = require('express').Router();
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { getDb } = require('../db');
const { requireAllAccess } = require('../auth/middleware');

// Signed download tokens are valid for 48 hours by default.
// Configurable via DOWNLOAD_TOKEN_TTL_HOURS env var.
const TOKEN_TTL_HOURS = parseInt(process.env.DOWNLOAD_TOKEN_TTL_HOURS || '48', 10);

// GET /api/library/:id/signed-url
// Requires all_access tier. Generates a signed download token for the media item.
// Returns: { signedUrl, expiresAt }
router.get('/library/:id/signed-url', requireAllAccess, (req, res) => {
  const db = getDb();

  const media = db.prepare(
    'SELECT id, filename, filepath, title, visibility FROM media WHERE id = ? AND is_active = 1'
  ).get(req.params.id);

  if (!media) {
    return res.status(404).json({ error: 'Media not found' });
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

// GET /api/download/:token
// Validates the signed token and streams the file.
// No auth header required — the token IS the auth mechanism.
// Expiry is the sole gate — tokens are not single-use to allow partial download retries.
router.get('/download/:token', (req, res) => {
  const { token } = req.params;

  if (!token || typeof token !== 'string' || token.length !== 64) {
    return res.status(400).json({ error: 'Invalid token' });
  }

  const db = getDb();

  const record = db.prepare(
    "SELECT dt.*, m.filepath, m.filename, m.title FROM download_tokens dt JOIN media m ON m.id = dt.media_id WHERE dt.token = ?"
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

  const filename = path.basename(record.filepath);
  res.download(record.filepath, filename);
});

module.exports = router;
