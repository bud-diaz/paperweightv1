const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const { URL: NodeURL } = require('url');
const multer = require('multer');
const { getDb, log } = require('../db');
const { requireDashboard } = require('../auth/middleware');
const { createToken, revokeToken, listTokens, updateTokenTier, listTokensForScope } = require('../auth');
const broadcast = require('../broadcast');
const config = require('../config');
const { probe } = require('../scanner/probe');

router.use(requireDashboard);

// ─── Multer upload config ─────────────────────────────────────────────────────

const VALID_CATEGORIES  = new Set(['music', 'beats', 'podcasts', 'videos', 'drafts', 'live_sessions']);
const VALID_VISIBILITY  = new Set(['public', 'supporters_only', 'vault']);

// MIME types accepted for vault uploads — audio and video only.
const ALLOWED_MIMES = new Set([
  'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/aiff',
  'audio/x-aiff', 'audio/flac', 'audio/x-flac', 'audio/aac', 'audio/ogg',
  'audio/mp4', 'audio/m4a', 'audio/x-m4a',
  'video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska',
  'video/webm', 'video/mpeg',
]);

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
    const safe = path.basename(file.originalname)
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
      .replace(/\s+/g, '_')
      .slice(0, 180);
    cb(null, safe);
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

    const category   = path.basename(req.file.destination);
    const visibility = VALID_VISIBILITY.has(req.body.visibility) ? req.body.visibility : 'public';
    const absFilepath = path.resolve(req.file.path);

    try {
      await probe(absFilepath);
    } catch (probeErr) {
      try { fs.unlinkSync(absFilepath); } catch {}
      log('warn', 'dashboard', `Rejected upload after ffprobe failure: ${req.file.filename} (${probeErr.message})`);
      return res.status(400).json({ error: `Uploaded file could not be inspected by ffprobe: ${probeErr.message}` });
    }

    // Stamp visibility immediately so the scanner's later upsert (which doesn't
    // touch the visibility column) preserves the creator's chosen value.
    // Use path.resolve() so this matches the absolute path the watcher emits.
    getDb().prepare(`
      INSERT INTO media (filepath, filename, category, visibility, indexed_at, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(filepath) DO UPDATE SET visibility = excluded.visibility
    `).run(absFilepath, req.file.filename, category, visibility);

    log('info', 'dashboard', `Uploaded: ${req.file.filename} → ${req.file.destination} [${visibility}]`);
    res.status(201).json({
      filename:   req.file.filename,
      filepath:   req.file.path,
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
           artist, album, producer, credits, indexed_at
    FROM media
    WHERE is_active = 1
    ORDER BY indexed_at DESC
    LIMIT 500
  `).all();
  res.json(items);
});

// PATCH /api/dashboard/media/:id
// Body: any subset of { visibility, title, artist, album, producer, credits }
router.patch('/media/:id', (req, res) => {
  const { visibility, title, artist, album, producer, credits } = req.body;
  const setClauses = [];
  const params     = [];

  if (visibility !== undefined) {
    if (!VALID_VISIBILITY.has(visibility)) {
      return res.status(400).json({ error: 'visibility must be public, supporters_only, or vault' });
    }
    setClauses.push('visibility = ?');
    params.push(visibility);
  }

  for (const [field, val] of Object.entries({ title, artist, album, producer, credits })) {
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

module.exports = router;
