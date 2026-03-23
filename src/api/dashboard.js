const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const { URL: NodeURL } = require('url');
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
    publicUrl: config.station.publicUrl || null,
    slug: config.station.slug || null,
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

// ─── Station registry ─────────────────────────────────────────────────────────

// GET /api/dashboard/station
// Returns the slug → URL registration for this station.
// Auto-claims from config on first call if STATION_SLUG + STATION_PUBLIC_URL are set.
router.get('/station', (req, res) => {
  const db = getDb();
  let row = db.prepare('SELECT * FROM station_registry WHERE id = 1').get();

  if (!row && config.station.slug && config.station.publicUrl) {
    db.prepare(
      'INSERT OR IGNORE INTO station_registry (id, slug, url) VALUES (1, ?, ?)'
    ).run(config.station.slug, config.station.publicUrl);
    row = db.prepare('SELECT * FROM station_registry WHERE id = 1').get();
  }

  if (!row) {
    return res.json({ slug: null, url: null, claimedAt: null, updatedAt: null });
  }

  res.json({
    slug:      row.slug,
    url:       row.url,
    claimedAt: row.claimed_at,
    updatedAt: row.updated_at,
  });
});

// PUT /api/dashboard/station/url
// Body: { url: "https://..." }
// Updates the registered URL and persists it to .env so it survives restarts.
router.put('/station/url', (req, res) => {
  const { url } = req.body;
  if (!url || typeof url !== 'string' || !url.trim()) {
    return res.status(400).json({ error: 'url is required' });
  }

  try { new NodeURL(url); } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  const db = getDb();
  const row = db.prepare('SELECT id FROM station_registry WHERE id = 1').get();
  if (!row) {
    return res.status(404).json({ error: 'Station not registered. Set STATION_SLUG in .env and restart.' });
  }

  db.prepare(
    "UPDATE station_registry SET url = ?, updated_at = datetime('now') WHERE id = 1"
  ).run(url);

  // Persist to .env so the value survives a restart
  updateEnvKey('STATION_PUBLIC_URL', url);
  config.station.publicUrl = url;

  log('info', 'dashboard', `Station URL updated to: ${url}`);
  res.json({ ok: true, url });
});

// GET /api/dashboard/station/health
// Server-side pings the registered URL to see if it's reachable by the outside world.
router.get('/station/health', async (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT url FROM station_registry WHERE id = 1').get();

  if (!row) {
    return res.json({ reachable: null, error: 'No URL registered', checkedAt: new Date().toISOString() });
  }

  const result = await pingUrl(row.url);
  res.json({ ...result, checkedAt: new Date().toISOString() });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Ping a URL's /api/health endpoint and return { reachable, latencyMs, error? }
function pingUrl(baseUrl) {
  return new Promise(resolve => {
    const start = Date.now();
    let target;
    try {
      target = new NodeURL('/api/health', baseUrl).href;
    } catch {
      return resolve({ reachable: false, latencyMs: 0, error: 'Invalid URL' });
    }

    const lib = target.startsWith('https:') ? https : http;
    const req = lib.get(target, { timeout: 5000 }, res => {
      res.resume();
      resolve({ reachable: res.statusCode >= 200 && res.statusCode < 500, latencyMs: Date.now() - start });
    });
    req.on('timeout', () => { req.destroy(); resolve({ reachable: false, latencyMs: 5000, error: 'Timeout' }); });
    req.on('error',   err => resolve({ reachable: false, latencyMs: Date.now() - start, error: err.message }));
  });
}

// Update or append a single KEY=value line in the .env file
function updateEnvKey(key, value) {
  const envPath = path.join(config.paths.root, '.env');
  if (!fs.existsSync(envPath)) return;
  let content = fs.readFileSync(envPath, 'utf8');
  const re = new RegExp(`^${key}=.*$`, 'm');
  content = re.test(content)
    ? content.replace(re, `${key}=${value}`)
    : content.trimEnd() + `\n${key}=${value}\n`;
  fs.writeFileSync(envPath, content, 'utf8');
}

module.exports = router;
