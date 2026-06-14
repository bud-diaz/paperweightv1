const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { getDb, log } = require('../db');
const { requireDashboard } = require('../auth/middleware');
const config = require('../config');

const PIC_DIR = path.join(config.paths.data, 'creator-assets');
const PIC_EXTS = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
const PIC_MIMES = new Set(Object.keys(PIC_EXTS));

const picStorage = multer.diskStorage({
  destination(req, file, cb) {
    fs.mkdirSync(PIC_DIR, { recursive: true });
    cb(null, PIC_DIR);
  },
  filename(req, file, cb) {
    cb(null, `profile_tmp_${Date.now()}${PIC_EXTS[file.mimetype] || '.jpg'}`);
  },
});

const uploadPic = multer({
  storage: picStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (PIC_MIMES.has(file.mimetype)) cb(null, true);
    else cb(new Error('Only image files are accepted for profile picture'));
  },
});

// GET /api/creator/profile — public, no auth
router.get('/profile', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM creator_profile WHERE id = 1').get();

  if (!row || !row.bio_enabled) {
    return res.json({ enabled: false });
  }

  const registry = db.prepare('SELECT claimed_at FROM station_registry WHERE id = 1').get();
  const latest = db.prepare(`
    SELECT id, title, filename, artist, category, artwork_url, indexed_at
    FROM media
    WHERE is_active = 1 AND visibility IN ('public', 'supporters_only')
    ORDER BY indexed_at DESC
    LIMIT 1
  `).get();

  res.json({
    enabled: true,
    bio: row.bio || null,
    profilePicUrl: row.profile_pic_url || null,
    social: {
      instagram:  row.social_instagram  || null,
      twitter:    row.social_twitter    || null,
      youtube:    row.social_youtube    || null,
      soundcloud: row.social_soundcloud || null,
      spotify:    row.social_spotify    || null,
      bandcamp:   row.social_bandcamp   || null,
    },
    creatorSince: registry ? registry.claimed_at : null,
    latestTrack: latest ? {
      id:       latest.id,
      title:    latest.title || latest.filename,
      artist:   latest.artist || null,
      category: latest.category || null,
      artworkUrl: latest.artwork_url || null,
    } : null,
    stationName:  config.station.name        || null,
    creatorName:  config.station.creatorName || null,
  });
});

// GET /api/creator/pic — serve profile pic
router.get('/pic', (req, res) => {
  const row = getDb().prepare('SELECT profile_pic_url FROM creator_profile WHERE id = 1').get();
  if (!row || !row.profile_pic_url) return res.status(404).end();
  const p = path.join(PIC_DIR, path.basename(row.profile_pic_url));
  if (!fs.existsSync(p)) return res.status(404).end();
  res.sendFile(p);
});

// ── Dashboard-protected routes ────────────────────────────────────────────────

// GET /api/creator/dashboard/profile
router.get('/dashboard/profile', requireDashboard, (req, res) => {
  const row = getDb().prepare('SELECT * FROM creator_profile WHERE id = 1').get();
  res.json(row || {});
});

// POST /api/creator/dashboard/profile
router.post('/dashboard/profile', requireDashboard, (req, res) => {
  const {
    bio_enabled, bio,
    social_instagram, social_twitter, social_youtube,
    social_soundcloud, social_spotify, social_bandcamp,
  } = req.body || {};

  const db = getDb();
  db.prepare(`
    UPDATE creator_profile SET
      bio_enabled       = ?,
      bio               = ?,
      social_instagram  = ?,
      social_twitter    = ?,
      social_youtube    = ?,
      social_soundcloud = ?,
      social_spotify    = ?,
      social_bandcamp   = ?,
      updated_at        = datetime('now')
    WHERE id = 1
  `).run(
    bio_enabled ? 1 : 0,
    bio || null,
    social_instagram  || null,
    social_twitter    || null,
    social_youtube    || null,
    social_soundcloud || null,
    social_spotify    || null,
    social_bandcamp   || null,
  );

  const updated = db.prepare('SELECT * FROM creator_profile WHERE id = 1').get();
  res.json(updated);
});

// POST /api/creator/dashboard/pic
router.post('/dashboard/pic', requireDashboard, (req, res) => {
  uploadPic.single('pic')(req, res, err => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const ext = PIC_EXTS[req.file.mimetype] || '.jpg';
    const finalName = `profile${ext}`;
    const finalPath = path.join(PIC_DIR, finalName);

    // Remove old pics across all extensions
    for (const e of Object.values(PIC_EXTS)) {
      const old = path.join(PIC_DIR, `profile${e}`);
      if (fs.existsSync(old)) { try { fs.unlinkSync(old); } catch {} }
    }

    try {
      fs.renameSync(req.file.path, finalPath);
    } catch (moveErr) {
      try { fs.unlinkSync(req.file.path); } catch {}
      log('error', 'creator', `Profile pic move failed: ${moveErr.message}`);
      return res.status(500).json({ error: 'Upload failed while saving profile picture' });
    }

    const picUrl = finalName;
    getDb().prepare(
      "UPDATE creator_profile SET profile_pic_url = ?, updated_at = datetime('now') WHERE id = 1"
    ).run(picUrl);

    res.json({ url: `/api/creator/pic` });
  });
});

module.exports = router;
