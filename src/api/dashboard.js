const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { URL: NodeURL } = require('url');
const multer = require('multer');
const { getDb, log } = require('../db');
const { requireDashboard } = require('../auth/middleware');
const { createToken, revokeToken, listTokens, updateTokenTier, listTokensForScope } = require('../auth');
const broadcast = require('../broadcast');
const live = require('../broadcast/live');
const config = require('../config');
const { probe } = require('../scanner/probe');
const { generateSecret, verifyTOTP, getOtpauthUri, generateRecoveryCodes, hashCode } = require('../auth/totp');
const { getFFmpegStatus } = require('../runtime/ffmpeg');
const asyncHandler = require('../middleware/asyncHandler');
const { clearArtworkCache, ARTWORK_DIR } = require('./library');
const { validateSlug } = require('../auth/reserved-slugs');

router.use(requireDashboard);

// ─── Multer upload config ─────────────────────────────────────────────────────

const VALID_CATEGORIES  = new Set(['music', 'beats', 'podcasts', 'videos', 'drafts', 'live_sessions']);
const VALID_VISIBILITY  = new Set(['public', 'supporters_only', 'vault']);
const UPLOAD_TMP_DIR = path.join(config.paths.data, 'upload_tmp');

// MIME types accepted for vault uploads — audio and video only.
const ALLOWED_MIMES = new Set([
  'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/aiff',
  'audio/x-aiff', 'audio/flac', 'audio/x-flac', 'audio/aac', 'audio/ogg',
  'audio/mp4', 'audio/m4a', 'audio/x-m4a',
  'video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska',
  'video/webm', 'video/mpeg',
]);

function sanitizeUploadName(originalname) {
  const ext = path.extname(String(originalname || ''))
    .replace(/[^.a-zA-Z0-9]/g, '')
    .slice(0, 12);
  let safe = path.basename(String(originalname || ''))
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 180);

  if (!safe || safe === '.' || safe === '..') {
    safe = `upload${ext}`;
  }
  return safe;
}

function resolveAvailableUploadPath(dest, originalname) {
  const safe = sanitizeUploadName(originalname);
  const ext = path.extname(safe);
  const stem = (ext ? safe.slice(0, -ext.length) : safe).slice(0, 150) || 'upload';
  let filename = `${stem}${ext}`;
  let candidate = path.join(dest, filename);
  for (let i = 1; fs.existsSync(candidate); i++) {
    filename = `${stem}_${i}${ext}`;
    candidate = path.join(dest, filename);
  }
  return { filename, filepath: candidate };
}

const storage = multer.diskStorage({
  destination(req, file, cb) {
    fs.mkdirSync(UPLOAD_TMP_DIR, { recursive: true });
    cb(null, UPLOAD_TMP_DIR);
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname).replace(/[^.a-zA-Z0-9]/g, '').slice(0, 12);
    cb(null, `upload_${Date.now()}_${crypto.randomBytes(6).toString('hex')}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2GB
  fileFilter(req, file, cb) {
    if (ALLOWED_MIMES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}. Only audio and video files are accepted.`));
    }
  },
});

const ARTWORK_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const ARTWORK_IMG_EXTS = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };

const artworkStorage = multer.diskStorage({
  destination(req, file, cb) {
    fs.mkdirSync(ARTWORK_DIR, { recursive: true });
    cb(null, ARTWORK_DIR);
  },
  filename(req, file, cb) {
    const ext = ARTWORK_IMG_EXTS[file.mimetype] || '.jpg';
    cb(null, `${req.params.id}_tmp_${Date.now()}${ext}`);
  },
});

const uploadArtwork = multer({
  storage: artworkStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter(req, file, cb) {
    if (ARTWORK_IMAGE_MIMES.has(file.mimetype)) cb(null, true);
    else cb(new Error('Only image files are accepted for artwork'));
  },
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
  upload.single('media')(req, res, async err => {
    if (err) {
      // Multer errors (file too large, wrong field name, etc.)
      return res.status(400).json({ error: err.message || 'Upload failed' });
    }
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const category   = VALID_CATEGORIES.has(req.body.category) ? req.body.category : 'music';
    const visibility = VALID_VISIBILITY.has(req.body.visibility) ? req.body.visibility : 'public';
    const tmpFilepath = path.resolve(req.file.path);

    try {
      await probe(tmpFilepath);
    } catch (probeErr) {
      try { fs.unlinkSync(tmpFilepath); } catch {}
      log('warn', 'dashboard', `Rejected upload after ffprobe failure: ${req.file.originalname} (${probeErr.message})`);
      return res.status(400).json({ error: `Uploaded file could not be inspected by ffprobe: ${probeErr.message}` });
    }

    const destDir = path.join(config.vault.path, category);
    fs.mkdirSync(destDir, { recursive: true });
    const finalFile = resolveAvailableUploadPath(destDir, req.file.originalname);
    try {
      fs.renameSync(tmpFilepath, finalFile.filepath);
    } catch (moveErr) {
      try { fs.unlinkSync(tmpFilepath); } catch {}
      log('error', 'dashboard', `Upload move failed: ${req.file.originalname} (${moveErr.message})`);
      return res.status(500).json({ error: 'Upload failed while moving file into the vault' });
    }
    const absFilepath = path.resolve(finalFile.filepath);

    // Stamp visibility immediately so the scanner's later upsert (which doesn't
    // touch the visibility column) preserves the creator's chosen value.
    // Use path.resolve() so this matches the absolute path the watcher emits.
    getDb().prepare(`
      INSERT INTO media (filepath, filename, category, visibility, indexed_at, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(filepath) DO UPDATE SET visibility = excluded.visibility
    `).run(absFilepath, finalFile.filename, category, visibility);

    log('info', 'dashboard', `Uploaded: ${finalFile.filename} -> ${destDir} [${visibility}]`);
    res.status(201).json({
      filename:   finalFile.filename,
      filepath:   absFilepath,
      size:       req.file.size,
      category,
      visibility,
    });
  });
});

// ─── Media management ────────────────────────────────────────────────────────

// GET /api/dashboard/media
// Returns all active media items including vault — creator sees everything.
router.get('/media', (req, res) => {
  const items = getDb().prepare(`
    SELECT id, title, filename, category, visibility, duration,
           artist, album, producer, credits, artwork_url, tags, indexed_at
    FROM media
    WHERE is_active = 1
    ORDER BY indexed_at DESC
    LIMIT 500
  `).all();
  res.json(items);
});

// PATCH /api/dashboard/media/:id
// Body: any subset of { visibility, title, artist, album, producer, credits, artwork_url }
router.patch('/media/:id', (req, res) => {
  const { visibility, title, artist, album, producer, credits, artwork_url } = req.body;
  const setClauses = [];
  const params     = [];

  if (visibility !== undefined) {
    if (!VALID_VISIBILITY.has(visibility)) {
      return res.status(400).json({ error: 'visibility must be public, supporters_only, or vault' });
    }
    setClauses.push('visibility = ?');
    params.push(visibility);
  }

  for (const [field, val] of Object.entries({ title, artist, album, producer, credits, artwork_url })) {
    if (val !== undefined) {
      setClauses.push(`${field} = ?`);
      params.push(val === '' ? null : val);
    }
  }

  if (setClauses.length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  setClauses.push("updated_at = datetime('now')");
  params.push(req.params.id);

  const info = getDb().prepare(
    `UPDATE media SET ${setClauses.join(', ')} WHERE id = ? AND is_active = 1`
  ).run(...params);
  if (info.changes === 0) return res.status(404).json({ error: 'Not found' });
  log('info', 'dashboard', `Media ${req.params.id} updated`);
  res.json({ ok: true, id: Number(req.params.id) });
});

// POST /api/dashboard/media/:id/artwork — upload an image file as artwork
router.post('/media/:id/artwork', uploadArtwork.single('artwork'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image file provided' });

  const id    = req.params.id;
  const ext   = ARTWORK_IMG_EXTS[req.file.mimetype] || '.jpg';
  // Remove any existing uploaded artwork for this id (all extensions)
  for (const e of Object.values(ARTWORK_IMG_EXTS)) {
    const old = path.join(ARTWORK_DIR, `${id}${e}`);
    if (fs.existsSync(old)) { try { fs.unlinkSync(old); } catch {} }
  }

  // Move tmp file to canonical name
  const dest = path.join(ARTWORK_DIR, `${id}${ext}`);
  try {
    fs.renameSync(req.file.path, dest);
  } catch {
    fs.copyFileSync(req.file.path, dest);
    fs.unlinkSync(req.file.path);
  }

  clearArtworkCache(id);
  log('info', 'dashboard', `Artwork uploaded for media ${id}`);
  res.json({ ok: true, artworkUrl: `/api/library/${id}/artwork` });
});

// ─── Tip configuration ────────────────────────────────────────────────────────

// GET /api/dashboard/tip-config
router.get('/tip-config', (req, res) => {
  const row = getDb().prepare('SELECT amounts, custom_enabled FROM tip_config WHERE id = 1').get();
  let amounts = [300, 500, 1000];
  try { if (row) amounts = JSON.parse(row.amounts); } catch {}
  const customEnabled = row ? row.custom_enabled === 1 : true;
  res.json({ amounts, customEnabled });
});

// PUT /api/dashboard/tip-config
// Body: { amounts: [cents, cents, cents], customEnabled: bool }
router.put('/tip-config', (req, res) => {
  const { amounts, customEnabled } = req.body;

  if (!Array.isArray(amounts) || amounts.length !== 3) {
    return res.status(400).json({ error: 'amounts must be an array of exactly 3 values' });
  }
  const parsed = amounts.map(a => parseInt(a, 10));
  if (parsed.some(a => isNaN(a) || a < 100)) {
    return res.status(400).json({ error: 'Each amount must be at least 100 cents ($1.00)' });
  }

  getDb().prepare(`
    INSERT INTO tip_config (id, amounts, custom_enabled, updated_at)
    VALUES (1, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      amounts        = excluded.amounts,
      custom_enabled = excluded.custom_enabled,
      updated_at     = excluded.updated_at
  `).run(JSON.stringify(parsed), customEnabled ? 1 : 0);

  log('info', 'dashboard', `Tip config updated: amounts=${parsed.join(',')} custom=${customEnabled}`);
  res.json({ ok: true, amounts: parsed, customEnabled: !!customEnabled });
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
// Body: { label, tier?, scope_type?, scope_id? }
router.post('/tokens', (req, res) => {
  const { label, tier, scope_type, scope_id } = req.body;
  if (!label || typeof label !== 'string' || !label.trim()) {
    return res.status(400).json({ error: 'label is required' });
  }
  const token = createToken(label.trim(), tier, scope_type || null, scope_id ?? null);
  const row   = getDb().prepare('SELECT id FROM tokens WHERE token = ?').get(token);
  res.status(201).json({ id: row?.id, token, label: label.trim(), tier: tier || 'subscriber', scope_type: scope_type || null, scope_id: scope_id ?? null });
});

// GET /api/dashboard/tokens/for/:scopeType/:scopeId
router.get('/tokens/for/:scopeType/:scopeId', (req, res) => {
  res.json(listTokensForScope(req.params.scopeType, req.params.scopeId));
});

// PATCH /api/dashboard/tokens/:id/tier
// Body: { tier: 'subscriber'|'pro'|'all_access' }
router.patch('/tokens/:id/tier', (req, res) => {
  const { tier } = req.body;
  try {
    updateTokenTier(req.params.id, tier);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/dashboard/tokens/:id
router.delete('/tokens/:id', (req, res) => {
  revokeToken(req.params.id);
  res.json({ ok: true });
});

// ─── Download leads ───────────────────────────────────────────────────────────

// GET /api/dashboard/download-leads
// Returns all emails captured on the download page, newest first.
router.get('/download-leads', (req, res) => {
  const rows = getDb().prepare(
    'SELECT id, email, platform, created_at FROM download_leads ORDER BY created_at DESC'
  ).all();
  res.json(rows);
});

// ─── Listener accounts list ──────────────────────────────────────────────────

// GET /api/dashboard/accounts
// Returns all active listener accounts for typeahead use in the dashboard.
router.get('/accounts', (req, res) => {
  const accounts = getDb().prepare(
    'SELECT id, email, created_at FROM listener_accounts WHERE is_active = 1 ORDER BY email ASC'
  ).all();
  res.json(accounts);
});

// ─── Token account assignments ────────────────────────────────────────────────

// GET /api/dashboard/tokens/:id/assignments
router.get('/tokens/:id/assignments', (req, res) => {
  const rows = getDb().prepare(`
    SELECT la.id, la.email, ta.created_at
    FROM token_assignments ta
    JOIN listener_accounts la ON la.id = ta.listener_id
    WHERE ta.token_id = ?
    ORDER BY ta.created_at ASC
  `).all(req.params.id);
  res.json(rows);
});

// POST /api/dashboard/tokens/:id/assignments
// Body: { email }
router.post('/tokens/:id/assignments', (req, res) => {
  const { email } = req.body;
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email is required' });
  }
  const db = getDb();
  const token = db.prepare('SELECT id FROM tokens WHERE id = ? AND is_active = 1').get(req.params.id);
  if (!token) return res.status(404).json({ error: 'Token not found' });

  const account = db.prepare(
    'SELECT id, email FROM listener_accounts WHERE email = ? AND is_active = 1'
  ).get(email.toLowerCase().trim());
  if (!account) return res.status(404).json({ error: 'No Paperweight account found for that email' });

  try {
    db.prepare('INSERT INTO token_assignments (token_id, listener_id) VALUES (?, ?)').run(req.params.id, account.id);
    log('info', 'dashboard', `Token ${req.params.id} assigned to listener ${account.id} (${account.email})`);
    res.status(201).json({ ok: true, listener_id: account.id, email: account.email });
  } catch (err) {
    if (err.message.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: 'Already assigned to this account' });
    }
    throw err;
  }
});

// DELETE /api/dashboard/tokens/:id/assignments/:listener_id
router.delete('/tokens/:id/assignments/:listener_id', (req, res) => {
  const info = getDb().prepare(
    'DELETE FROM token_assignments WHERE token_id = ? AND listener_id = ?'
  ).run(req.params.id, req.params.listener_id);
  if (info.changes === 0) return res.status(404).json({ error: 'Assignment not found' });
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
    const slugCheck = validateSlug(config.station.slug);
    if (!slugCheck.valid) {
      return res.status(400).json({ error: slugCheck.reason });
    }
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

// GET /api/dashboard/runtime
// Dashboard-only deployment/runtime diagnostics.
router.get('/runtime', (req, res) => {
  res.json({
    version: config.version,
    host: config.host,
    trustProxy: config.trustProxy,
    ffmpeg: getFFmpegStatus(),
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
router.get('/station/health', asyncHandler(async (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT url FROM station_registry WHERE id = 1').get();

  if (!row) {
    return res.json({ reachable: null, error: 'No URL registered', checkedAt: new Date().toISOString() });
  }

  const result = await pingUrl(row.url);
  res.json({ ...result, checkedAt: new Date().toISOString() });
}));

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

// GET /api/dashboard/payment-config
// Returns which payment env vars are configured (never exposes the values themselves).
router.get('/payment-config', (req, res) => {
  const has = key => !!(process.env[key] && process.env[key].trim());
  const tipRow = getDb().prepare('SELECT amounts, custom_enabled FROM tip_config WHERE id = 1').get();
  let tipAmounts = [300, 500, 1000];
  try { if (tipRow) tipAmounts = JSON.parse(tipRow.amounts); } catch {}

  res.json({
    stripe: {
      connected:        has('STRIPE_SECRET_KEY'),
      webhookConfigured: has('STRIPE_WEBHOOK_SECRET'),
      prices: {
        subscriber:  has('STRIPE_PRICE_SUBSCRIBER'),
        pro:         has('STRIPE_PRICE_PRO'),
        allAccess:   has('STRIPE_PRICE_ALL_ACCESS'),
      },
    },
    paypal: {
      connected: has('PAYPAL_CLIENT_ID') && has('PAYPAL_CLIENT_SECRET'),
      plans: {
        pro:       has('PAYPAL_PLAN_PRO'),
        allAccess: has('PAYPAL_PLAN_ALL_ACCESS'),
      },
    },
    tips: {
      enabled:       !!(tipRow),
      amounts:       tipAmounts,
      customEnabled: tipRow ? tipRow.custom_enabled === 1 : true,
    },
  });
});

// GET /api/dashboard/webhook-log?limit=50&provider=stripe
// Returns recent webhook events for production debugging.
router.get('/webhook-log', (req, res) => {
  const limitNum    = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const { provider } = req.query;

  let sql    = 'SELECT * FROM webhook_events';
  const params = [];
  if (provider === 'stripe' || provider === 'paypal') {
    sql += ' WHERE provider = ?';
    params.push(provider);
  }
  sql += ' ORDER BY received_at DESC LIMIT ?';
  params.push(limitNum);

  const rows = getDb().prepare(sql).all(...params);
  res.json({ events: rows, total: rows.length });
});

// ─── 2FA management ──────────────────────────────────────────────────────────

// In-memory pending setup secret (awaiting TOTP confirmation before enabling).
// Single-user app — one pending setup at a time is fine.
let pendingSetup = null;

// GET /api/dashboard/2fa/status
router.get('/2fa/status', (req, res) => {
  const row = getDb().prepare('SELECT enabled FROM dashboard_2fa WHERE id = 1').get();
  res.json({ enabled: !!(row && row.enabled) });
});

// POST /api/dashboard/2fa/setup
// Generates a new TOTP secret. Does NOT enable 2FA — call /2fa/confirm next.
router.post('/2fa/setup', (req, res) => {
  const secret = generateSecret();
  pendingSetup = { secret, createdAt: Date.now() };
  res.json({ secret, otpauthUri: getOtpauthUri(secret, config.station.name) });
});

// POST /api/dashboard/2fa/confirm
// Body: { code } — verifies TOTP against the pending secret and enables 2FA.
// Returns one-time recovery codes — the client must display and save these.
router.post('/2fa/confirm', (req, res) => {
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ error: 'code is required' });

  if (!pendingSetup || Date.now() - pendingSetup.createdAt > 10 * 60 * 1000) {
    pendingSetup = null;
    return res.status(400).json({ error: 'No pending setup — call /2fa/setup first' });
  }

  if (!verifyTOTP(pendingSetup.secret, String(code).replace(/\s/g, ''))) {
    return res.status(400).json({ error: 'Invalid code — check your authenticator app' });
  }

  const recoveryCodes = generateRecoveryCodes();
  const hashedCodes   = recoveryCodes.map(hashCode);

  getDb().prepare(`
    INSERT INTO dashboard_2fa (id, secret, enabled, recovery_codes)
    VALUES (1, ?, 1, ?)
    ON CONFLICT(id) DO UPDATE SET
      secret         = excluded.secret,
      enabled        = 1,
      recovery_codes = excluded.recovery_codes
  `).run(pendingSetup.secret, JSON.stringify(hashedCodes));

  pendingSetup = null;
  log('info', 'dashboard', '2FA enabled');
  res.json({ ok: true, recoveryCodes }); // shown once — user must save these
});

// DELETE /api/dashboard/2fa
// Body: { code } — disables 2FA after confirming the current TOTP code.
router.delete('/2fa', (req, res) => {
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ error: 'Current authenticator code is required' });

  const row = getDb().prepare('SELECT secret FROM dashboard_2fa WHERE id = 1 AND enabled = 1').get();
  if (!row) return res.status(400).json({ error: '2FA is not currently enabled' });

  if (!verifyTOTP(row.secret, String(code).replace(/\s/g, ''))) {
    return res.status(400).json({ error: 'Invalid code' });
  }

  getDb().prepare('UPDATE dashboard_2fa SET enabled = 0 WHERE id = 1').run();
  log('info', 'dashboard', '2FA disabled');
  res.json({ ok: true });
});

// ─── Live broadcast ───────────────────────────────────────────────────────────

// GET /api/dashboard/live/status
router.get('/live/status', (req, res) => {
  res.json(live.getLiveState());
});

// POST /api/dashboard/live/start
router.post('/live/start', (req, res) => {
  try {
    live.startLive();
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/dashboard/live/chunk
// Content-Type: application/octet-stream — raw s16le PCM, 44100Hz mono
router.post('/live/chunk',
  express.raw({ type: 'application/octet-stream', limit: '4mb' }),
  asyncHandler(async (req, res) => {
    if (!req.body || !req.body.length) {
      return res.status(400).json({ error: 'Empty chunk' });
    }
    try {
      const result = await live.pushAudio(req.body);
      if (result?.busy) {
        res.setHeader('Retry-After', '1');
        return res.status(429).json({ error: 'Live encoder busy' });
      }
      if (result?.inactive) {
        return res.status(409).json({ error: 'Live broadcast is not active' });
      }
      if (result?.error) {
        return res.status(500).json({ error: 'Live audio write failed' });
      }
      res.json({ ok: true, backpressure: !!result?.backpressure });
    } catch (err) {
      log('error', 'dashboard', `Live audio chunk failed: ${err.message}`);
      res.status(500).json({ error: 'Live audio write failed' });
    }
  }),
);

// POST /api/dashboard/live/stop
router.post('/live/stop', (req, res) => {
  live.stopLive();
  res.json({ ok: true });
});

// GET /api/dashboard/creator-type
router.get('/creator-type', (req, res) => {
  res.json({ creatorType: config.station.creatorType });
});

// ─── Broadcast queue ──────────────────────────────────────────────────────────
// GET /api/dashboard/broadcast/queue
router.get('/broadcast/queue', (req, res) => {
  const queue = broadcast.getStationQueue();
  const db = getDb();
  const items = queue.map(mediaId => {
    const row = db.prepare('SELECT id, title, filename, artist FROM media WHERE id = ? AND is_active = 1').get(mediaId);
    return row ? { id: row.id, title: row.title || row.filename, artist: row.artist || null } : null;
  }).filter(Boolean);
  res.json({ queue: items });
});

// POST /api/dashboard/broadcast/queue
// Body: { mediaId }
router.post('/broadcast/queue', (req, res) => {
  const { mediaId } = req.body;
  if (!mediaId) return res.status(400).json({ error: 'mediaId required' });
  const row = getDb().prepare('SELECT id FROM media WHERE id = ? AND is_active = 1').get(mediaId);
  if (!row) return res.status(404).json({ error: 'Track not found' });
  const ok = broadcast.addToStationQueue(Number(mediaId));
  if (!ok) return res.status(400).json({ error: 'Queue is full (max 5)' });
  const queue = broadcast.getStationQueue();
  res.json({ ok: true, queueLength: queue.length });
});

// DELETE /api/dashboard/broadcast/queue/:idx
router.delete('/broadcast/queue/:idx', (req, res) => {
  const idx = parseInt(req.params.idx, 10);
  broadcast.removeFromStationQueue(idx);
  res.json({ ok: true });
});

// ─── Radio Host mode toggle ───────────────────────────────────────────────────
// GET /api/dashboard/radio-host
router.get('/radio-host', (req, res) => {
  const creatorType = config.station.creatorType;
  const isRadioHost = creatorType === 'radio_host';
  const switches    = parseInt(process.env.RADIO_HOST_SWITCHES || '0', 10);
  const locked      = switches >= 3;
  res.json({ radioHost: isRadioHost, switches, locked });
});

// POST /api/dashboard/radio-host
// Toggles CREATOR_TYPE between 'creator' and 'radio_host', tracks switch count.
router.post('/radio-host', (req, res) => {
  const envPath = require('path').join(config.paths.root, '.env');
  const currentType = config.station.creatorType;
  const switches    = parseInt(process.env.RADIO_HOST_SWITCHES || '0', 10);

  if (switches >= 3) {
    return res.status(403).json({ error: 'Mode locked after 3 switches. Edit CREATOR_TYPE in .env to change.' });
  }

  const newType    = currentType === 'radio_host' ? 'creator' : 'radio_host';
  const newSwitches = switches + 1;

  try {
    let envContents = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';

    function setEnvKey(contents, key, value) {
      const re = new RegExp(`^${key}=.*$`, 'm');
      const line = `${key}=${value}`;
      return re.test(contents)
        ? contents.replace(re, line)
        : contents + (contents.endsWith('\n') ? '' : '\n') + line + '\n';
    }

    envContents = setEnvKey(envContents, 'CREATOR_TYPE', newType);
    envContents = setEnvKey(envContents, 'RADIO_HOST_SWITCHES', String(newSwitches));

    fs.writeFileSync(envPath, envContents, 'utf8');

    process.env.CREATOR_TYPE       = newType;
    process.env.RADIO_HOST_SWITCHES = String(newSwitches);
    config.station.creatorType      = newType;
  } catch (err) {
    return res.status(500).json({ error: `Could not update .env: ${err.message}` });
  }

  res.json({ radioHost: newType === 'radio_host', switches: newSwitches, locked: newSwitches >= 3 });
});

// GET /api/dashboard/external-search?platform=youtube|soundcloud&q=...
router.get('/external-search', asyncHandler(async (req, res) => {
  const { platform, q } = req.query;
  if (!q || !q.trim()) return res.json({ items: [] });

  if (platform === 'youtube') {
    const apiKey = config.externalSearch.youtubeApiKey;
    if (!apiKey) return res.json({ items: [] });

    const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoCategoryId=10&maxResults=10&q=${encodeURIComponent(q)}&key=${encodeURIComponent(apiKey)}`;
    const searchData = await new Promise((resolve, reject) => {
      https.get(searchUrl, r => {
        let buf = '';
        r.on('data', d => { buf += d; });
        r.on('end', () => { try { resolve(JSON.parse(buf)); } catch (e) { reject(e); } });
      }).on('error', reject);
    });

    if (!searchData.items || !searchData.items.length) return res.json({ items: [] });

    const ids = searchData.items.map(i => i.id.videoId).join(',');
    const detailUrl = `https://www.googleapis.com/youtube/v3/videos?part=contentDetails,snippet&id=${encodeURIComponent(ids)}&key=${encodeURIComponent(apiKey)}`;
    const detailData = await new Promise((resolve, reject) => {
      https.get(detailUrl, r => {
        let buf = '';
        r.on('data', d => { buf += d; });
        r.on('end', () => { try { resolve(JSON.parse(buf)); } catch (e) { reject(e); } });
      }).on('error', reject);
    });

    const items = (detailData.items || []).map(v => {
      const dur = v.contentDetails?.duration || '';
      const m = dur.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
      const secs = m ? (parseInt(m[1]||0)*3600 + parseInt(m[2]||0)*60 + parseInt(m[3]||0)) : null;
      return {
        id:          v.id,
        title:       v.snippet?.title || '',
        artist:      v.snippet?.channelTitle || '',
        thumbnail:   v.snippet?.thumbnails?.default?.url || '',
        duration:    secs,
        externalUrl: `https://www.youtube.com/watch?v=${v.id}`,
        platform:    'youtube',
      };
    });
    return res.json({ items });
  }

  if (platform === 'soundcloud') {
    const clientId = config.externalSearch.soundcloudClientId;
    if (!clientId) return res.json({ items: [] });

    const scUrl = `https://api.soundcloud.com/tracks?q=${encodeURIComponent(q)}&client_id=${encodeURIComponent(clientId)}&limit=10`;
    const scData = await new Promise((resolve, reject) => {
      https.get(scUrl, r => {
        let buf = '';
        r.on('data', d => { buf += d; });
        r.on('end', () => { try { resolve(JSON.parse(buf)); } catch (e) { reject(e); } });
      }).on('error', reject);
    });

    const items = (Array.isArray(scData) ? scData : []).map(t => ({
      id:          String(t.id),
      title:       t.title || '',
      artist:      t.user?.username || '',
      thumbnail:   t.artwork_url || '',
      duration:    t.duration ? Math.round(t.duration / 1000) : null,
      externalUrl: t.permalink_url || '',
      platform:    'soundcloud',
    }));
    return res.json({ items });
  }

  res.json({ items: [] });
}));

// POST /api/dashboard/media/external
router.post('/media/external', asyncHandler(async (req, res) => {
  const { title, artist, platform, externalUrl, duration } = req.body || {};
  if (!title || !platform || !externalUrl) {
    return res.status(400).json({ error: 'title, platform, and externalUrl are required' });
  }
  const safeId   = crypto.randomBytes(8).toString('hex');
  const filepath = `external://${platform}/${safeId}`;
  const db = getDb();
  const row = db.prepare(`
    INSERT INTO media (filepath, filename, category, title, artist, duration, visibility, source_platform, external_url, is_active)
    VALUES (?, ?, 'music', ?, ?, ?, 'public', ?, ?, 1)
  `).run(filepath, title.trim(), title.trim(), artist || null, duration || null, platform, externalUrl);
  res.json({ id: row.lastInsertRowid, title: title.trim() });
}));

module.exports = router;
module.exports.sanitizeUploadName = sanitizeUploadName;
module.exports.resolveAvailableUploadPath = resolveAvailableUploadPath;
