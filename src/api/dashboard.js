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
const { requireDesktop } = require('../auth/platform');
const { createToken, revokeToken, listTokens, updateTokenTier, listTokensForScope, hashToken } = require('../auth');
const broadcast = require('../broadcast');
const live = require('../broadcast/live');
const config = require('../config');
const { probe } = require('../scanner/probe');
const { generateSecret, verifyTOTP, getOtpauthUri, generateRecoveryCodes, hashCode } = require('../auth/totp');
const { getFFmpegStatus } = require('../runtime/ffmpeg');
const cloudflareApi = require('../runtime/cloudflare');
const asyncHandler = require('../middleware/asyncHandler');
const { clearArtworkCache, ARTWORK_DIR } = require('./library');
const { isBroadcastPlayableTrack } = require('../broadcast/playlist');
const { validateSlug } = require('../auth/reserved-slugs');
const { resolvesToBlockedAddress } = require('../runtime/net-guard');
const { isValidExternalHttpUrl } = require('../runtime/base-url');
const { IMAGE_MIMES, IMAGE_EXTS, sniffImageFile } = require('../runtime/images');
const { getBoolSetting, setSetting } = require('../db/settings');
const { toSqliteDatetime } = require('../runtime/datetime');
const {
  SUBSCRIBER_HEADERS, LISTENER_HEADERS, DOWNLOAD_LEAD_HEADERS,
  getDownloadLeadRows, getSubscriberRows, getListenerRows,
  csvEscape, toCsvString,
} = require('../export/exports');

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

const artworkStorage = multer.diskStorage({
  destination(req, file, cb) {
    fs.mkdirSync(ARTWORK_DIR, { recursive: true });
    cb(null, ARTWORK_DIR);
  },
  filename(req, file, cb) {
    const ext = IMAGE_EXTS[file.mimetype] || '.jpg';
    cb(null, `${req.params.id}_tmp_${Date.now()}${ext}`);
  },
});

const uploadArtwork = multer({
  storage: artworkStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter(req, file, cb) {
    if (IMAGE_MIMES.has(file.mimetype)) cb(null, true);
    else cb(new Error('Only image files are accepted for artwork'));
  },
});

function removeFile(filepath) {
  try { if (filepath) fs.unlinkSync(filepath); } catch {}
}

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
           artist, album, genre, producer, credits, artwork_url, tags,
           offline_allowed, indexed_at, release_at
    FROM media
    WHERE is_active = 1
    ORDER BY indexed_at DESC
    LIMIT 500
  `).all();
  res.json(items);
});

// PATCH /api/dashboard/media/:id
// Body: any subset of { visibility, title, artist, album, genre, producer, credits, artwork_url, offline_allowed, release_at }
// release_at: ISO datetime string to schedule an automatic flip to 'public',
// or null to cancel a pending schedule.
router.patch('/media/:id', (req, res) => {
  const {
    visibility,
    title,
    artist,
    album,
    genre,
    producer,
    credits,
    artwork_url,
    offline_allowed,
    release_at,
  } = req.body;
  const setClauses = [];
  const params     = [];

  if (visibility !== undefined) {
    if (!VALID_VISIBILITY.has(visibility)) {
      return res.status(400).json({ error: 'visibility must be public, supporters_only, or vault' });
    }
    setClauses.push('visibility = ?');
    params.push(visibility);
  }

  if (offline_allowed !== undefined) {
    setClauses.push('offline_allowed = ?');
    params.push(offline_allowed === true || offline_allowed === 1 || offline_allowed === '1' ? 1 : 0);
  }

  if (artwork_url !== undefined && artwork_url !== '' && artwork_url !== null && !isValidExternalHttpUrl(artwork_url)) {
    return res.status(400).json({ error: 'artwork_url must be an http or https URL' });
  }

  let releaseAtHandled = false;
  if (release_at !== undefined) {
    releaseAtHandled = true;
    if (release_at === null || release_at === '') {
      setClauses.push('release_at = NULL');
    } else {
      const normalized = toSqliteDatetime(release_at);
      if (!normalized) {
        return res.status(400).json({ error: 'release_at must be a valid datetime' });
      }
      if (normalized <= toSqliteDatetime(new Date())) {
        return res.status(400).json({ error: 'release_at must be in the future' });
      }
      setClauses.push('release_at = ?');
      params.push(normalized);
    }
  }

  // Going public right now supersedes any pending scheduled release.
  if (visibility === 'public' && !releaseAtHandled) {
    setClauses.push('release_at = NULL');
  }

  for (const [field, val] of Object.entries({ title, artist, album, genre, producer, credits, artwork_url })) {
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
router.post('/media/:id/artwork', (req, res) => {
  uploadArtwork.single('artwork')(req, res, err => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No image file provided' });

    const detectedMime = sniffImageFile(req.file.path);
    if (!detectedMime || !IMAGE_MIMES.has(detectedMime)) {
      removeFile(req.file.path);
      return res.status(400).json({ error: 'Uploaded artwork is not a supported image file' });
    }

    const id    = req.params.id;
    const ext   = IMAGE_EXTS[detectedMime];
    // Remove any existing uploaded artwork for this id (all extensions)
    for (const e of Object.values(IMAGE_EXTS)) {
      const old = path.join(ARTWORK_DIR, `${id}${e}`);
      if (fs.existsSync(old)) removeFile(old);
    }

    // Move tmp file to canonical name
    const dest = path.join(ARTWORK_DIR, `${id}${ext}`);
    try {
      fs.renameSync(req.file.path, dest);
    } catch {
      fs.copyFileSync(req.file.path, dest);
      removeFile(req.file.path);
    }

    clearArtworkCache(id);
    log('info', 'dashboard', `Artwork uploaded for media ${id}`);
    res.json({ ok: true, artworkUrl: `/api/library/${id}/artwork` });
  });
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

// POST /api/dashboard/broadcast/stop
router.post('/broadcast/stop', (req, res) => {
  broadcast.stop();
  res.json({ ok: true, stopped: true });
});

// ─── Token management ─────────────────────────────────────────────────────────

// GET /api/dashboard/tokens
router.get('/tokens', requireDesktop, (req, res) => {
  res.json(listTokens());
});

// POST /api/dashboard/tokens
// Body: { label, tier?, scope_type?, scope_id? }
router.post('/tokens', requireDesktop, (req, res) => {
  const { label, tier, scope_type, scope_id } = req.body;
  if (!label || typeof label !== 'string' || !label.trim()) {
    return res.status(400).json({ error: 'label is required' });
  }
  const token = createToken(label.trim(), tier, scope_type || null, scope_id ?? null);
  const row   = getDb().prepare('SELECT id FROM tokens WHERE token_hash = ?').get(hashToken(token));
  res.status(201).json({ id: row?.id, token, label: label.trim(), tier: tier || 'subscriber', scope_type: scope_type || null, scope_id: scope_id ?? null });
});

// GET /api/dashboard/tokens/for/:scopeType/:scopeId
router.get('/tokens/for/:scopeType/:scopeId', requireDesktop, (req, res) => {
  res.json(listTokensForScope(req.params.scopeType, req.params.scopeId));
});

// PATCH /api/dashboard/tokens/:id/tier
// Body: { tier: 'subscriber'|'pro'|'all_access' }
router.patch('/tokens/:id/tier', requireDesktop, (req, res) => {
  const { tier } = req.body;
  try {
    updateTokenTier(req.params.id, tier);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/dashboard/tokens/:id
router.delete('/tokens/:id', requireDesktop, (req, res) => {
  revokeToken(req.params.id);
  res.json({ ok: true });
});

// ─── Download leads ───────────────────────────────────────────────────────────

// GET /api/dashboard/download-leads
// Returns the latest emails captured on the download page, newest first.
router.get('/download-leads', (req, res) => {
  const rows = getDb().prepare(
    'SELECT id, email, platform, updates_opt_in AS updatesOptIn, created_at FROM download_leads ORDER BY created_at DESC LIMIT 500'
  ).all();
  res.json(rows);
});

// ─── CSV exports ─────────────────────────────────────────────────────────────
// Lets creators pull their audience into a mailing tool without any built-in
// bulk mailer. Values are formula-escaped so a hostile email like
// "=HYPERLINK(...)" can't execute when the CSV is opened in a spreadsheet.

function sendCsv(res, filename, headers, rows) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(toCsvString(headers, rows));
}

// GET /api/dashboard/export/download-leads.csv
router.get('/export/download-leads.csv', (req, res) => {
  sendCsv(res, 'download-leads.csv', DOWNLOAD_LEAD_HEADERS, getDownloadLeadRows(getDb()));
});

// GET /api/dashboard/export/subscribers.csv — listeners with an active subscription.
router.get('/export/subscribers.csv', (req, res) => {
  sendCsv(res, 'subscribers.csv', SUBSCRIBER_HEADERS, getSubscriberRows(getDb()));
});

// GET /api/dashboard/export/listeners.csv — every registered listener account.
router.get('/export/listeners.csv', (req, res) => {
  sendCsv(res, 'listeners.csv', LISTENER_HEADERS, getListenerRows(getDb()));
});

// Consented marketing contacts, deduplicated by email: welcome-page profiles
// with marketing_opt_in and download leads with updates_opt_in. Strictly
// opt-in — an email stored without its consent flag never appears here.
function collectAudience() {
  const db = getDb();
  const byEmail = new Map();

  const profiles = db.prepare(`
    SELECT email, display_name, created_at FROM listener_profiles
    WHERE marketing_opt_in = 1 AND email IS NOT NULL
    ORDER BY created_at ASC
  `).all();
  for (const p of profiles) {
    const key = p.email.toLowerCase();
    if (!byEmail.has(key)) {
      byEmail.set(key, { email: p.email, name: p.display_name, source: 'listener_profile', created_at: p.created_at });
    }
  }

  const leads = db.prepare(`
    SELECT email, platform, created_at FROM download_leads
    WHERE updates_opt_in = 1
    ORDER BY created_at ASC
  `).all();
  for (const l of leads) {
    const key = l.email.toLowerCase();
    if (!byEmail.has(key)) {
      byEmail.set(key, { email: l.email, name: null, source: 'download_lead', created_at: l.created_at });
    }
  }

  return [...byEmail.values()];
}

// GET /api/dashboard/audience — the creator's marketing email list (JSON).
router.get('/audience', (req, res) => {
  const contacts = collectAudience();
  res.json({
    total: contacts.length,
    bySource: contacts.reduce((acc, c) => {
      acc[c.source] = (acc[c.source] || 0) + 1;
      return acc;
    }, {}),
    contacts,
  });
});

// GET /api/dashboard/export/audience.csv — the same list as a CSV download.
router.get('/export/audience.csv', (req, res) => {
  sendCsv(res, 'audience.csv', ['email', 'name', 'source', 'created_at'], collectAudience());
});

// ─── Earnings ────────────────────────────────────────────────────────────────

// GET /api/dashboard/earnings
// Revenue summary across every source: per-track/per-project vault unlocks
// (units sold + gross), tips, and active subscription counts. Amounts are
// integer cents; no amounts are invented — subscriptions report counts only
// because per-period amounts live at the provider.
router.get('/earnings', (req, res) => {
  const db = getDb();

  const unlockRows = db.prepare(`
    SELECT vu.unlock_type, vu.target_id,
           COUNT(*) AS units, COALESCE(SUM(vu.amount_paid), 0) AS gross_cents,
           m.title AS media_title, m.filename AS media_filename,
           vp.name AS project_name
    FROM vault_unlocks vu
    LEFT JOIN media m ON vu.unlock_type = 'track' AND m.id = vu.target_id
    LEFT JOIN vault_projects vp ON vu.unlock_type = 'project' AND vp.id = vu.target_id
    GROUP BY vu.unlock_type, vu.target_id
    ORDER BY gross_cents DESC
  `).all();

  const unlocks = unlockRows.map(r => ({
    unlockType: r.unlock_type,
    targetId: r.target_id,
    title: r.unlock_type === 'all_access'
      ? 'All-Access Vault'
      : (r.media_title || r.media_filename || r.project_name || `#${r.target_id}`),
    unitsSold: r.units,
    revenueCents: r.gross_cents,
  }));

  const tipStats = db.prepare(
    'SELECT COUNT(*) AS count, COALESCE(SUM(amount_cents), 0) AS gross_cents FROM tips'
  ).get();
  const recentTips = db.prepare(
    'SELECT amount_cents, created_at FROM tips ORDER BY created_at DESC LIMIT 10'
  ).all();

  const subStats = db.prepare(`
    SELECT tier, COUNT(*) AS count FROM subscriptions
    WHERE status = 'active' AND datetime(current_period_end) > datetime('now')
    GROUP BY tier
  `).all();

  const unlockRevenueCents = unlocks.reduce((sum, u) => sum + u.revenueCents, 0);
  const unlockUnits = unlocks.reduce((sum, u) => sum + u.unitsSold, 0);

  res.json({
    totals: {
      revenueCents: unlockRevenueCents + tipStats.gross_cents,
      unlockRevenueCents,
      tipRevenueCents: tipStats.gross_cents,
      unitsSold: unlockUnits,
      tipCount: tipStats.count,
      activeSubscriptions: subStats.reduce((sum, s) => sum + s.count, 0),
    },
    unlocks,
    tips: { count: tipStats.count, grossCents: tipStats.gross_cents, recent: recentTips },
    subscriptions: subStats.map(s => ({ tier: s.tier, count: s.count })),
  });
});

// ─── Database backup ─────────────────────────────────────────────────────────

// GET /api/dashboard/backup
// Streams a consistent hot backup of the SQLite database (better-sqlite3 online
// backup API — safe while the server runs). The temp file is removed after the
// download; scripts/backup.js is the scheduled/local variant that keeps copies.
router.get('/backup', asyncHandler(async (req, res) => {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  const backupDir = path.join(config.paths.data, 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const dest = path.join(backupDir, `paperweight-download-${stamp}.db`);

  await getDb().backup(dest);
  log('info', 'dashboard', 'Database backup downloaded');
  res.download(dest, `paperweight-backup-${stamp}.db`, () => {
    fs.unlink(dest, () => {});
  });
}));

// ─── Listener accounts list ──────────────────────────────────────────────────

// GET /api/dashboard/accounts
// Returns all active listener accounts for typeahead use in the dashboard.
router.get('/accounts', (req, res) => {
  const accounts = getDb().prepare(
    'SELECT id, email, created_at FROM listener_accounts WHERE is_active = 1 ORDER BY email ASC'
  ).all();
  res.json(accounts);
});

// POST /api/dashboard/accounts/:id/reset-link
// Mints a password reset link for a listener account so the creator can hand it
// out over their own channel. This is the recovery path when SMTP is not
// configured (and works either way).
router.post('/accounts/:id/reset-link', (req, res) => {
  const db = getDb();
  const account = db.prepare(
    'SELECT id, email FROM listener_accounts WHERE id = ? AND is_active = 1'
  ).get(req.params.id);
  if (!account) return res.status(404).json({ error: 'Listener account not found' });

  const { createPasswordReset, resetLinkUrl } = require('./listener');
  const { token, expiresAt } = createPasswordReset(db, account.id, 'dashboard');
  log('info', 'dashboard', `Password reset link generated for listener #${account.id}`);
  res.json({ email: account.email, url: resetLinkUrl(req, token), expiresAt });
});

// ─── Token account assignments ────────────────────────────────────────────────

// GET /api/dashboard/tokens/:id/assignments
router.get('/tokens/:id/assignments', requireDesktop, (req, res) => {
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
router.post('/tokens/:id/assignments', requireDesktop, (req, res) => {
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
router.delete('/tokens/:id/assignments/:listener_id', requireDesktop, (req, res) => {
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

  // Independent of `requirements` above (which gates /station/searchable):
  // whether a Cloudflare API token is saved, so the dashboard knows whether
  // to offer the auto-tunnel flow at all.
  const cloudflareApiConfigured = cloudflareApi.isCloudflareApiConfigured(config.station.cloudflareApiToken);

  if (!row) {
    return res.json({
      slug: null,
      url: null,
      claimedAt: null,
      updatedAt: null,
      searchable: getBoolSetting('station_searchable', false),
      requirements: {
        cloudflareTunnel: config.station.cloudflareTunnel,
        publicUrlSet: false,
      },
      cloudflareApiConfigured,
    });
  }

  res.json({
    slug:      row.slug,
    url:       row.url,
    claimedAt: row.claimed_at,
    updatedAt: row.updated_at,
    searchable: getBoolSetting('station_searchable', false),
    requirements: {
      cloudflareTunnel: config.station.cloudflareTunnel,
      publicUrlSet: !!(row && row.url),
    },
    cloudflareApiConfigured,
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
router.put('/station/url', requireDesktop, (req, res) => {
  const { url } = req.body;
  if (!url || typeof url !== 'string' || !url.trim()) {
    return res.status(400).json({ error: 'url is required' });
  }
  // The URL constructor silently strips CR/LF, so a value carrying a newline
  // would pass validation and then inject extra lines when written to .env.
  // Reject those (and '#') up front, before parsing.
  if (/[\r\n#]/.test(url)) {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  let parsed;
  try { parsed = new NodeURL(url); } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return res.status(400).json({ error: 'URL must be http(s)' });
  }

  // Persist the normalized href, never the raw input.
  const cleanUrl = parsed.href;

  const db = getDb();
  const row = db.prepare('SELECT id FROM station_registry WHERE id = 1').get();
  if (!row) {
    return res.status(404).json({ error: 'Station not registered. Set STATION_SLUG in .env and restart.' });
  }

  db.prepare(
    "UPDATE station_registry SET url = ?, updated_at = datetime('now') WHERE id = 1"
  ).run(cleanUrl);

  // Persist to .env so the value survives a restart
  updateEnvKey('STATION_PUBLIC_URL', cleanUrl);
  config.station.publicUrl = cleanUrl;

  log('info', 'dashboard', `Station URL updated to: ${cleanUrl}`);
  res.json({ ok: true, url: cleanUrl });
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

// PUT /api/dashboard/station/searchable
// Body: { enabled: boolean }
router.put('/station/searchable', requireDesktop, asyncHandler(async (req, res) => {
  const enabled = !!(req.body && req.body.enabled);

  if (!enabled) {
    setSetting('station_searchable', '0');
    log('info', 'dashboard', 'Station directory searchability disabled');
    return res.json({ ok: true, searchable: false });
  }

  const row = getDb().prepare('SELECT url FROM station_registry WHERE id = 1').get();
  const publicUrl = (row && row.url) || config.station.publicUrl || null;
  const checks = {
    cloudflareTunnel: config.station.cloudflareTunnel,
    publicUrlSet: !!publicUrl,
    reachable: false,
  };

  if (!checks.cloudflareTunnel || !checks.publicUrlSet) {
    return res.status(409).json({ error: 'Requirements not met', checks });
  }

  const ping = await pingUrl(publicUrl);
  checks.reachable = ping.reachable === true;
  if (!checks.reachable) {
    return res.status(409).json({ error: ping.error || 'Station not reachable from the outside', checks });
  }

  setSetting('station_searchable', '1');
  log('info', 'dashboard', 'Station directory searchability enabled');
  res.json({ ok: true, searchable: true, checks });
}));

// ─── Cloudflare API-token automation (optional) ───────────────────────────────
// Distinct from CLOUDFLARE_TUNNEL_TOKEN above: this lets the dashboard call
// Cloudflare's REST API on the owner's behalf to create a tunnel and DNS
// record, instead of the owner doing it by hand in the Zero Trust dashboard.
// Entirely optional — CLOUDFLARE_TUNNEL_TOKEN keeps working exactly as before
// whether or not this is ever used.

const HOSTNAME_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i;

// PUT /api/dashboard/station/cloudflare/token
// Body: { apiToken }
// Verifies the token against Cloudflare, then persists it to .env.
router.put('/station/cloudflare/token', requireDesktop, asyncHandler(async (req, res) => {
  const { apiToken } = req.body || {};
  if (!apiToken || typeof apiToken !== 'string' || !apiToken.trim() || /[\r\n#]/.test(apiToken)) {
    return res.status(400).json({ error: 'apiToken is required' });
  }
  const cleanToken = apiToken.trim();

  const verified = await cloudflareApi.verifyToken(cleanToken);
  if (!verified.ok) {
    return res.status(400).json({ error: verified.error || 'Could not verify Cloudflare API token' });
  }

  updateEnvKey('CLOUDFLARE_API_TOKEN', cleanToken);
  config.station.cloudflareApiToken = cleanToken;

  log('info', 'dashboard', 'Cloudflare API token saved and verified');
  res.json({ ok: true });
}));

// GET /api/dashboard/station/cloudflare/zones
// Lists the Cloudflare zones (domains) available to the saved API token, for
// the dashboard's "which domain should the tunnel use" picker.
router.get('/station/cloudflare/zones', requireDesktop, asyncHandler(async (req, res) => {
  const token = config.station.cloudflareApiToken;
  if (!cloudflareApi.isCloudflareApiConfigured(token)) {
    return res.status(409).json({ error: 'Save a Cloudflare API token first' });
  }

  const zones = await cloudflareApi.listZones(token);
  if (!zones.ok) {
    return res.status(502).json({ error: zones.error || 'Could not list Cloudflare zones' });
  }

  res.json({ zones: (zones.result || []).map(z => ({ id: z.id, name: z.name })) });
}));

// POST /api/dashboard/station/cloudflare/auto-tunnel
// Body: { zoneId, hostname }
// Creates a Named Tunnel + DNS route via the Cloudflare API and persists the
// resulting CLOUDFLARE_TUNNEL_TOKEN and STATION_PUBLIC_URL, same as if the
// owner had done it by hand and pasted the result into the dashboard/.env.
router.post('/station/cloudflare/auto-tunnel', requireDesktop, asyncHandler(async (req, res) => {
  const token = config.station.cloudflareApiToken;
  if (!cloudflareApi.isCloudflareApiConfigured(token)) {
    return res.status(409).json({ error: 'Save a Cloudflare API token first' });
  }

  const { zoneId, hostname } = req.body || {};
  if (!zoneId || typeof zoneId !== 'string') {
    return res.status(400).json({ error: 'zoneId is required' });
  }
  if (!hostname || typeof hostname !== 'string' || !HOSTNAME_RE.test(hostname.trim())) {
    return res.status(400).json({ error: 'A valid hostname is required (e.g. radio.yoursite.com)' });
  }
  const cleanHostname = hostname.trim().toLowerCase();

  const accounts = await cloudflareApi.listAccounts(token);
  if (!accounts.ok) {
    return res.status(502).json({ error: accounts.error || 'Could not list Cloudflare accounts' });
  }
  if (!accounts.result || accounts.result.length !== 1) {
    const count = accounts.result ? accounts.result.length : 0;
    return res.status(409).json({ error: `Expected exactly one Cloudflare account for this token, found ${count}` });
  }
  const accountId = accounts.result[0].id;

  const tunnelName = `paperweight-${(config.station.slug || 'station').slice(0, 40)}`;
  const tunnel = await cloudflareApi.createTunnel(token, accountId, tunnelName);
  if (!tunnel.ok) {
    return res.status(502).json({ error: tunnel.error || 'Could not create Cloudflare tunnel' });
  }
  const tunnelId = tunnel.result.id;

  const tunnelToken = await cloudflareApi.getTunnelToken(token, accountId, tunnelId);
  if (!tunnelToken.ok) {
    return res.status(502).json({ error: tunnelToken.error || 'Could not fetch the tunnel connector token' });
  }

  const dnsRoute = await cloudflareApi.createDnsRoute(token, accountId, tunnelId, zoneId, cleanHostname, config.port);
  if (!dnsRoute.ok) {
    return res.status(502).json({ error: dnsRoute.error || 'Could not create the DNS route' });
  }

  const publicUrl = `https://${cleanHostname}`;

  updateEnvKey('CLOUDFLARE_TUNNEL_TOKEN', tunnelToken.result);
  updateEnvKey('STATION_PUBLIC_URL', publicUrl);
  updateEnvKey('TRUST_PROXY', 'loopback');
  config.station.cloudflareTunnel = true;
  config.station.publicUrl = publicUrl;

  const db = getDb();
  const row = db.prepare('SELECT id FROM station_registry WHERE id = 1').get();
  if (row) {
    db.prepare("UPDATE station_registry SET url = ?, updated_at = datetime('now') WHERE id = 1").run(publicUrl);
  }

  log('info', 'dashboard', `Cloudflare tunnel auto-created for ${cleanHostname}`);
  res.json({
    ok: true,
    url: publicUrl,
    tunnelToken: tunnelToken.result,
    restartRequired: true,
    note: 'Run `cloudflared service install <token>` with the tunnelToken above (see CLOUDFLARE_SETUP.md), then restart Paperweight.',
  });
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Ping a URL's /api/health endpoint and return { reachable, latencyMs, error? }.
// Resolves the host first and refuses private/loopback/metadata targets so the
// owner-set station URL can't be used to probe the server's internal network.
async function pingUrl(baseUrl) {
  const start = Date.now();
  let parsed;
  try {
    parsed = new NodeURL('/api/health', baseUrl);
  } catch {
    return { reachable: false, latencyMs: 0, error: 'Invalid URL' };
  }

  if (await resolvesToBlockedAddress(parsed.hostname)) {
    return { reachable: false, latencyMs: Date.now() - start, error: 'URL resolves to a private or reserved address' };
  }

  return new Promise(resolve => {
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.get(parsed.href, { timeout: 5000 }, res => {
      res.resume();
      resolve({ reachable: res.statusCode >= 200 && res.statusCode < 500, latencyMs: Date.now() - start });
    });
    req.on('timeout', () => { req.destroy(); resolve({ reachable: false, latencyMs: 5000, error: 'Timeout' }); });
    req.on('error',   err => resolve({ reachable: false, latencyMs: Date.now() - start, error: err.message }));
  });
}

// Update or append a single KEY=value line in the .env file.
// Rejects values carrying CR/LF/# so a caller can never inject additional .env
// lines. The replacement uses a function (not a string) so special replacement
// patterns in `value` ($&, $', $`, $n) can't corrupt the file.
function updateEnvKey(key, value) {
  const val = String(value ?? '');
  if (/[\r\n#]/.test(val)) {
    throw new Error(`Refusing to write ${key}: value contains a newline or '#'`);
  }
  const envPath = path.join(config.paths.root, '.env');
  if (!fs.existsSync(envPath)) return;
  let content = fs.readFileSync(envPath, 'utf8');
  const re = new RegExp(`^${key}=.*$`, 'm');
  const line = `${key}=${val}`;
  content = re.test(content)
    ? content.replace(re, () => line)
    : content.trimEnd() + `\n${line}\n`;
  fs.writeFileSync(envPath, content, 'utf8');
}

// ─── Station settings (notifications + RSS feed) ────────────────────────────

// GET /api/dashboard/settings
router.get('/settings', (req, res) => {
  const { getSetting, getBoolSetting } = require('../db/settings');
  const { isEmailConfigured } = require('../email');
  res.json({
    notifyWebhookUrl: getSetting('notify_webhook_url') || '',
    notifyLiveEnabled: getBoolSetting('notify_live_enabled', true),
    feedEnabled: getBoolSetting('feed_enabled', false),
    feedScope: getSetting('feed_scope') || 'podcasts',
    trackGlowColor: getSetting('track_glow_color') || '#39ff14',
    emailConfigured: isEmailConfigured(),
  });
});

// PUT /api/dashboard/settings
// Body: any subset of { notifyWebhookUrl, notifyLiveEnabled, feedEnabled, feedScope, trackGlowColor }
router.put('/settings', (req, res) => {
  const { setSetting } = require('../db/settings');
  const body = req.body || {};

  if (body.notifyWebhookUrl !== undefined) {
    const url = String(body.notifyWebhookUrl || '').trim();
    let cleanUrl = null;
    if (url) {
      let parsed;
      try { parsed = new NodeURL(url); } catch {
        return res.status(400).json({ error: 'notifyWebhookUrl is not a valid URL' });
      }
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return res.status(400).json({ error: 'notifyWebhookUrl must be http(s)' });
      }
      cleanUrl = parsed.href;
    }
    setSetting('notify_webhook_url', cleanUrl);
  }
  if (body.notifyLiveEnabled !== undefined) {
    setSetting('notify_live_enabled', body.notifyLiveEnabled ? '1' : '0');
  }
  if (body.feedEnabled !== undefined) {
    setSetting('feed_enabled', body.feedEnabled ? '1' : '0');
  }
  if (body.feedScope !== undefined) {
    if (!['podcasts', 'all'].includes(body.feedScope)) {
      return res.status(400).json({ error: "feedScope must be 'podcasts' or 'all'" });
    }
    setSetting('feed_scope', body.feedScope);
  }
  if (body.trackGlowColor !== undefined) {
    const color = String(body.trackGlowColor || '').trim();
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
      return res.status(400).json({ error: 'trackGlowColor must be a 6-digit hex color' });
    }
    setSetting('track_glow_color', color);
  }

  log('info', 'dashboard', 'Station settings updated');
  res.json({ ok: true });
});

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
router.get('/webhook-log', requireDesktop, (req, res) => {
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
  // Store the hash of the dash-free, uppercase form so it matches how codes are
  // normalized at verification time (verify-2fa strips dashes before hashing).
  const hashedCodes   = recoveryCodes.map(c => hashCode(c.replace(/[\s-]/g, '').toUpperCase()));

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
    live.startLiveMic();
    require('../notify').liveStarted();
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

// ─── External encoder (RTMP) broadcast ────────────────────────────────────────
// Desktop-only: the RTMP listener binds to the local machine/LAN, which only
// makes sense for a station run from the desktop app. On the hosted web
// platform there's no local encoder to receive from, so requireDesktop keeps
// these routes (and the port they'd open) off entirely rather than exposing
// a listener that could never be reached from a legitimate OBS setup.

function externalBroadcastState() {
  const liveState = live.getLiveState();
  if (liveState.source !== 'rtmp') return 'idle';
  return liveState.isLive ? 'live' : 'pending';
}

// GET /api/dashboard/broadcast/external/status
router.get('/broadcast/external/status', requireDesktop, (req, res) => {
  const liveState = live.getLiveState();
  res.json({
    state: externalBroadcastState(),
    startedAt: liveState.startedAt,
    rtmp: live.getRtmpConnectionInfo(),
  });
});

// POST /api/dashboard/broadcast/external/start
router.post('/broadcast/external/start', requireDesktop, asyncHandler(async (req, res) => {
  const liveState = live.getLiveState();
  if (liveState.isLive || liveState.rtmpPending) {
    return res.status(409).json({ error: 'A broadcast is already live or pending' });
  }
  try {
    await live.startLiveRtmp({});
    res.json({ state: externalBroadcastState(), rtmp: live.getRtmpConnectionInfo() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}));

// POST /api/dashboard/broadcast/external/stop
router.post('/broadcast/external/stop', requireDesktop, (req, res) => {
  live.stopLive();
  res.json({ ok: true });
});

// POST /api/dashboard/broadcast/external/regenerate-key
router.post('/broadcast/external/regenerate-key', requireDesktop, (req, res) => {
  try {
    const streamKey = live.regenerateStreamKey();
    res.json({ ok: true, streamKey });
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
});

// GET /api/dashboard/creator-type
router.get('/creator-type', (req, res) => {
  res.json({
    creatorType: config.station.creatorType,
    stationIdentity: config.station.identity,
  });
});

// ─── Broadcast queue ──────────────────────────────────────────────────────────
// GET /api/dashboard/broadcast/queue
router.get('/broadcast/queue', (req, res) => {
  const queue = broadcast.getStationQueue();
  const db = getDb();
  const items = queue.map(mediaId => {
    const row = db.prepare(`
      SELECT id, filepath, title, filename, artist, visibility, is_active
      FROM media
      WHERE id = ? AND is_active = 1
    `).get(mediaId);
    if (!isBroadcastPlayableTrack(row)) return null;
    return row ? { id: row.id, title: row.title || row.filename, artist: row.artist || null } : null;
  }).filter(Boolean);
  res.json({ queue: items });
});

// POST /api/dashboard/broadcast/queue
// Body: { mediaId }
router.post('/broadcast/queue', (req, res) => {
  const { mediaId } = req.body;
  if (!mediaId) return res.status(400).json({ error: 'mediaId required' });
  const row = getDb().prepare(`
    SELECT id, filepath, visibility, is_active
    FROM media
    WHERE id = ? AND is_active = 1
  `).get(mediaId);
  if (!row) return res.status(404).json({ error: 'Track not found' });
  if (!isBroadcastPlayableTrack(row)) {
    return res.status(400).json({ error: 'Only public local tracks can be queued for broadcast' });
  }
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
router.get('/radio-host', requireDesktop, (req, res) => {
  const creatorType = config.station.creatorType;
  const isRadioHost = creatorType === 'radio_host';
  const switches    = parseInt(process.env.RADIO_HOST_SWITCHES || '0', 10);
  const locked      = switches >= 3;
  res.json({ radioHost: isRadioHost, switches, locked });
});

// POST /api/dashboard/radio-host
// Toggles CREATOR_TYPE between 'creator' and 'radio_host', tracks switch count.
router.post('/radio-host', requireDesktop, (req, res) => {
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
router.get('/external-search', requireDesktop, asyncHandler(async (req, res) => {
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
router.post('/media/external', requireDesktop, asyncHandler(async (req, res) => {
  const { title, artist, platform, externalUrl, duration } = req.body || {};
  if (!title || !platform || !externalUrl) {
    return res.status(400).json({ error: 'title, platform, and externalUrl are required' });
  }
  const db = getDb();

  const existing = db.prepare(`
    SELECT id, title, is_active FROM media WHERE source_platform = ? AND external_url = ?
  `).get(platform, externalUrl);

  if (existing) {
    if (!existing.is_active) {
      db.prepare(`UPDATE media SET is_active = 1 WHERE id = ?`).run(existing.id);
    }
    return res.json({ id: existing.id, title: existing.title, duplicate: true });
  }

  const safeId   = crypto.randomBytes(8).toString('hex');
  const filepath = `external://${platform}/${safeId}`;
  const row = db.prepare(`
    INSERT INTO media (filepath, filename, category, title, artist, duration, visibility, source_platform, external_url, is_active)
    VALUES (?, ?, 'music', ?, ?, ?, 'public', ?, ?, 1)
  `).run(filepath, title.trim(), title.trim(), artist || null, duration || null, platform, externalUrl);
  res.json({ id: row.lastInsertRowid, title: title.trim() });
}));

module.exports = router;
module.exports.sanitizeUploadName = sanitizeUploadName;
module.exports.resolveAvailableUploadPath = resolveAvailableUploadPath;
module.exports.csvEscape = csvEscape;
module.exports.updateEnvKey = updateEnvKey;
