const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { getDb } = require('../db');
const { requireSubscriber } = require('../auth/middleware');
const config = require('../config');

const PREVIEW_DIR = path.join(config.paths.hlsOutput, 'previews');
const PREVIEW_DURATION = 60;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildMediaQuery({ category, search, tier }) {
  const conditions = ['m.is_active = 1'];
  const params = {};

  // Free tier sees only public media; subscribers see public + supporters_only
  if (tier === 'subscriber') {
    conditions.push("m.visibility IN ('public', 'supporters_only')");
  } else {
    conditions.push("m.visibility = 'public'");
  }

  if (category) {
    conditions.push('m.category = :category');
    params.category = category;
  }

  if (search) {
    conditions.push('(m.title LIKE :search OR m.artist LIKE :search OR m.filename LIKE :search)');
    params.search = `%${search}%`;
  }

  return { conditions, params };
}

function formatItem(row, tier) {
  const base = {
    id: row.id,
    title: row.title || row.filename,
    artist: row.artist || null,
    album: row.album || null,
    category: row.category,
    duration: row.duration,
    bpm: row.bpm || null,
    tags: row.tags ? JSON.parse(row.tags) : [],
    visibility: row.visibility,
    previewUrl: `/api/library/${row.id}/preview`,
    indexedAt: row.indexed_at,
  };

  if (tier === 'subscriber') {
    base.downloadUrl = `/api/library/${row.id}/download`;
  }

  return base;
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// GET /api/library
router.get('/', (req, res) => {
  const { category, search, page = '1', limit = '20' } = req.query;
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (pageNum - 1) * limitNum;

  const { conditions, params } = buildMediaQuery({ category, search, tier: req.tier });
  const where = 'WHERE ' + conditions.join(' AND ');

  const db = getDb();
  const total = db.prepare(`SELECT COUNT(*) as n FROM media m ${where}`).get(params).n;
  const items = db.prepare(
    `SELECT * FROM media m ${where} ORDER BY m.indexed_at DESC LIMIT :limit OFFSET :offset`
  ).all({ ...params, limit: limitNum, offset });

  res.json({
    items: items.map(r => formatItem(r, req.tier)),
    total,
    page: pageNum,
    limit: limitNum,
    pages: Math.ceil(total / limitNum),
  });
});

// GET /api/library/:id
router.get('/:id', (req, res) => {
  const row = getDb().prepare(
    'SELECT * FROM media WHERE id = ? AND is_active = 1'
  ).get(req.params.id);

  if (!row) return res.status(404).json({ error: 'Not found' });

  // Subscribers can see supporters_only; free tier cannot
  if (row.visibility === 'supporters_only' && req.tier !== 'subscriber') {
    return res.status(403).json({ error: 'Subscriber access required' });
  }

  res.json(formatItem(row, req.tier));
});

// GET /api/library/:id/preview
// Generates a 60-second AAC clip on first request, serves cached file after.
router.get('/:id/preview', (req, res) => {
  const row = getDb().prepare(
    "SELECT * FROM media WHERE id = ? AND is_active = 1 AND visibility != 'private'"
  ).get(req.params.id);

  if (!row) return res.status(404).json({ error: 'Not found' });

  const previewPath = path.join(PREVIEW_DIR, `${row.id}.mp3`);

  // Serve cached preview if it exists
  if (fs.existsSync(previewPath)) {
    return res.sendFile(previewPath);
  }

  // Generate preview with FFmpeg
  const args = [
    '-y',
    '-i', row.filepath,
    '-t', String(PREVIEW_DURATION),
    '-vn',
    '-c:a', 'aac',
    '-b:a', '96k',
    '-ac', '2',
    previewPath,
  ];

  const proc = spawn('ffmpeg', args, { stdio: 'ignore' });

  proc.on('error', err => {
    if (!res.headersSent) {
      res.status(503).json({ error: 'Preview generation unavailable (ffmpeg not installed)' });
    }
  });

  proc.on('close', code => {
    if (code === 0 && fs.existsSync(previewPath)) {
      res.sendFile(previewPath);
    } else if (!res.headersSent) {
      res.status(500).json({ error: 'Preview generation failed' });
    }
  });
});

// GET /api/library/:id/download  (subscribers only)
router.get('/:id/download', requireSubscriber, (req, res) => {
  const row = getDb().prepare(
    'SELECT * FROM media WHERE id = ? AND is_active = 1'
  ).get(req.params.id);

  if (!row) return res.status(404).json({ error: 'Not found' });
  if (!fs.existsSync(row.filepath)) {
    return res.status(404).json({ error: 'File not found on disk' });
  }

  res.download(row.filepath, path.basename(row.filepath));
});

module.exports = router;
