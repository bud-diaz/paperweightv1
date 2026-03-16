const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { getDb, log } = require('../db');
const { requireDashboard } = require('../auth/middleware');
const { createToken, revokeToken, listTokens } = require('../auth');
const broadcast = require('../broadcast');
const config = require('../config');

router.use(requireDashboard);

// ─── Multer upload config ─────────────────────────────────────────────────────

const VALID_CATEGORIES = new Set(['music', 'beats', 'podcasts', 'videos', 'drafts', 'live_sessions']);

const storage = multer.diskStorage({
  destination(req, file, cb) {
    const category = VALID_CATEGORIES.has(req.body.category)
      ? req.body.category
      : 'music';
    const dest = path.join(config.vault.path, category);
    fs.mkdirSync(dest, { recursive: true });
    cb(null, dest);
  },
  filename(req, file, cb) {
    // Sanitize filename: strip path traversal, replace spaces
    const safe = path.basename(file.originalname).replace(/\s+/g, '_');
    cb(null, safe);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2GB
});

// ─── Vault stats ─────────────────────────────────────────────────────────────

// GET /api/dashboard/vault
router.get('/vault', (req, res) => {
  const db = getDb();

  const totals = db.prepare(`
    SELECT
      COUNT(*) AS totalFiles,
      SUM(duration) / 3600.0 AS totalHours,
      MAX(indexed_at) AS lastScanAt
    FROM media
    WHERE is_active = 1
  `).get();

  const byCategory = db.prepare(`
    SELECT category, COUNT(*) AS count
    FROM media
    WHERE is_active = 1
    GROUP BY category
  `).all().reduce((acc, r) => { acc[r.category] = r.count; return acc; }, {});

  res.json({
    totalFiles: totals.totalFiles || 0,
    totalHours: Math.round((totals.totalHours || 0) * 10) / 10,
    lastScanAt: totals.lastScanAt || null,
    byCategory,
  });
});

// ─── Upload ───────────────────────────────────────────────────────────────────

// POST /api/dashboard/upload
// Multipart: field 'media' (file), optional 'category' (string)
// The vault watcher picks up the file automatically after upload.
router.post('/upload', (req, res) => {
  upload.single('media')(req, res, err => {
    if (err) {
      // Multer errors (file too large, wrong field name, etc.)
      return res.status(400).json({ error: err.message || 'Upload failed' });
    }
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    log('info', 'dashboard', `Uploaded: ${req.file.filename} → ${req.file.destination}`);
    res.status(201).json({
      filename: req.file.filename,
      filepath: req.file.path,
      size: req.file.size,
      category: path.basename(req.file.destination),
    });
  });
});

// ─── Broadcast control ────────────────────────────────────────────────────────

// POST /api/dashboard/broadcast/mode
// Body: { mode: 'shuffle' | 'scheduled' }
router.post('/broadcast/mode', (req, res) => {
  const { mode } = req.body;
  if (!mode) return res.status(400).json({ error: 'mode is required' });

  try {
    broadcast.setMode(mode);
    res.json({ ok: true, mode });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/dashboard/broadcast/restart
router.post('/broadcast/restart', (req, res) => {
  const currentMode = broadcast.getState().mode || 'shuffle';
  broadcast.stop();
  setTimeout(() => broadcast.start(currentMode), 1000);
  res.json({ ok: true, restarting: true });
});

// ─── Token management ─────────────────────────────────────────────────────────

// GET /api/dashboard/tokens
router.get('/tokens', (req, res) => {
  res.json(listTokens());
});

// POST /api/dashboard/tokens
// Body: { label: string }
router.post('/tokens', (req, res) => {
  const { label } = req.body;
  if (!label || typeof label !== 'string' || !label.trim()) {
    return res.status(400).json({ error: 'label is required' });
  }
  const token = createToken(label.trim());
  res.status(201).json({ token, label: label.trim() });
});

// DELETE /api/dashboard/tokens/:id
router.delete('/tokens/:id', (req, res) => {
  revokeToken(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
