const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { getDb } = require('../db');
const { isSubscriberTier, canAccessMedia, canDownloadMedia, allAccessTierIncludesVault, hasScopedVaultAccess } = require('../auth/access');
const { effectiveTierForTokenRow } = require('../auth/middleware');
const config = require('../config');
const { ffmpegPath, installHint } = require('../runtime/ffmpeg');
const { normalizeUnlockOptions } = require('./vault');
const { previewLimiter, streamLimiter } = require('../middleware/rateLimiter');
const { checkAndRecordPlay, quotaStatus } = require('../middleware/playQuota');
const { safeVaultPath } = require('./safeVaultPath');
const asyncHandler = require('../middleware/asyncHandler');
const { isValidExternalHttpUrl } = require('../runtime/base-url');
const { setImageHeaders } = require('../runtime/images');

const PREVIEW_DIR = path.join(config.paths.hlsOutput, 'previews');
const PREVIEW_DURATION = 60;
const previewJobs = new Map();

// In-memory artwork cache: id → Buffer|null (null = confirmed no artwork)
const artworkCache = new Map();
const artworkPending = new Map(); // id → [res, ...]
const MAX_ARTWORK_CACHE = 60;

const ARTWORK_DIR = path.join(config.paths.data, 'artwork');
const ARTWORK_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
const ARTWORK_MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };

function findUploadedArtwork(id) {
  for (const ext of ARTWORK_EXTS) {
    const p = path.join(ARTWORK_DIR, `${id}${ext}`);
    if (fs.existsSync(p)) return { filepath: p, mime: ARTWORK_MIME[ext] };
  }
  return null;
}

function redirectArtworkUrl(res, rawUrl) {
  if (!isValidExternalHttpUrl(rawUrl)) return res.status(404).end();
  return res.redirect(302, rawUrl);
}

function clearArtworkCache(id) {
  artworkCache.delete(String(id));
}

function signingSecret() {
  return config.auth.downloadSigningSecret;
}

function encodeDownloadContext(context = {}) {
  if (context.type === 'listener' && context.tokenId) {
    return `listener:${context.tokenId}`;
  }
  if (context.type === 'share' && context.token) {
    return `share:${context.token}`;
  }
  return 'legacy';
}

function signDownloadUrl(mediaId, context = {}) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const ctx = encodeDownloadContext(context);
  const sig = crypto.createHmac('sha256', signingSecret())
    .update(`${mediaId}:${exp}:${ctx}`)
    .digest('hex');
  return {
    signedUrl: `/api/library/${mediaId}/file?exp=${exp}&ctx=${encodeURIComponent(ctx)}&sig=${sig}`,
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}

function verifyDownloadSig(mediaId, exp, sig, ctx = 'legacy') {
  const now = Math.floor(Date.now() / 1000);
  if (!exp || !sig || parseInt(exp, 10) < now) return false;
  const expected = crypto.createHmac('sha256', signingSecret())
    .update(`${mediaId}:${exp}:${ctx}`)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

function shareLinkActive(db, token, mediaId) {
  const row = db.prepare('SELECT * FROM share_links WHERE token = ?').get(token);
  if (!row || (row.expires_at && new Date(row.expires_at).getTime() < Date.now())) return false;
  if (row.target_type === 'track') return Number(row.target_id) === Number(mediaId);
  if (row.target_type !== 'project') return false;
  return !!db.prepare(
    'SELECT 1 FROM vault_project_items WHERE project_id = ? AND content_id = ?'
  ).get(row.target_id, mediaId);
}

function signedDownloadAllowed(db, row, ctx) {
  if (!ctx || ctx === 'legacy') return false;

  if (ctx.startsWith('share:')) {
    return shareLinkActive(db, ctx.slice('share:'.length), row.id);
  }

  if (ctx.startsWith('listener:')) {
    const tokenId = parseInt(ctx.slice('listener:'.length), 10);
    if (!tokenId) return false;
    const tokenRow = db.prepare('SELECT * FROM tokens WHERE id = ? AND is_active = 1').get(tokenId);
    if (!tokenRow) return false;
    const reqLike = {
      tier: effectiveTierForTokenRow(tokenRow),
      tokenRow,
    };
    return canDownloadMedia(reqLike, row, getProjectId(row.id)).allowed;
  }

  return false;
}

function parseTags(tags) {
  if (!tags) return [];
  try {
    const parsed = JSON.parse(tags);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function buildMediaQuery({ category, search, genre, tier }) {
  const conditions = ['m.is_active = 1'];
  const params = {};

  // Gated rows are visible in browse views; access routes still enforce locks.
  conditions.push("m.visibility IN ('public', 'supporters_only', 'vault')");

  if (category) {
    conditions.push('m.category = :category');
    params.category = category;
  }

  if (genre) {
    conditions.push('m.genre = :genre COLLATE NOCASE');
    params.genre = genre;
  }

  if (search) {
    conditions.push('(m.title LIKE :search OR m.artist LIKE :search OR m.filename LIKE :search)');
    params.search = `%${search}%`;
  }

  return { conditions, params };
}

// Per-request pricing + unlock state, computed in one pass so list endpoints
// can annotate every item without per-item access queries.
function buildOwnershipContext(req) {
  const db = getDb();
  const listenerId = req.tokenRow?.listener_id || null;

  const ctx = {
    tier: req.tier,
    tokenRow: req.tokenRow || null,
    subscriberVault: isSubscriberTier(req.tier) && allAccessTierIncludesVault(),
    allAccess: false,
    trackIds: new Set(),
    projectIds: new Set(),
    prices: new Map(
      db.prepare(
        'SELECT content_id, suggested_price, minimum_price, allow_free, payment_type, recurring_interval, currency FROM vault_prices'
      ).all().map(r => [r.content_id, r])
    ),
    trackToProject: new Map(
      db.prepare('SELECT project_id, content_id FROM vault_project_items').all()
        .map(pi => [pi.content_id, pi.project_id])
    ),
  };

  if (listenerId) {
    const unlocks = db.prepare(`
      SELECT unlock_type, target_id FROM vault_unlocks
      WHERE listener_id = ? AND active = 1
        AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))
    `).all(listenerId);
    for (const u of unlocks) {
      if (u.unlock_type === 'all_access') ctx.allAccess = true;
      else if (u.unlock_type === 'track') ctx.trackIds.add(Number(u.target_id));
      else if (u.unlock_type === 'project') ctx.projectIds.add(Number(u.target_id));
    }
  }

  return ctx;
}

function isUnlockedInContext(row, ctx) {
  if (row.visibility === 'public') return true;
  if (row.visibility === 'supporters_only') {
    return isSubscriberTier(ctx.tier)
      || hasScopedVaultAccess({ tokenRow: ctx.tokenRow }, row.id, ctx.trackToProject.get(row.id) ?? null);
  }
  // vault
  if (ctx.subscriberVault || ctx.allAccess) return true;
  if (ctx.trackIds.has(Number(row.id))) return true;
  const projectId = ctx.trackToProject.get(row.id) ?? null;
  if (projectId !== null && ctx.projectIds.has(Number(projectId))) return true;
  return hasScopedVaultAccess({ tokenRow: ctx.tokenRow }, row.id, projectId);
}

function formatItem(row, tier, ctx = null) {
  const isVideo = !!(row.mime_type && row.mime_type.startsWith('video/'));
  const isVault = row.visibility === 'vault';
  const base = {
    id: row.id,
    title: row.title || row.filename,
    artist:     row.artist     || null,
    album:      row.album      || null,
    genre:      row.genre      || null,
    producer:   row.producer   || null,
    credits:    row.credits    || null,
    artwork_url: row.artwork_url || null,
    category: row.category,
    duration: row.duration,
    bpm: row.bpm || null,
    tags: parseTags(row.tags),
    visibility: row.visibility,
    mimeType: row.mime_type || null,
    isVideo,
    isVault,
    isExternal: String(row.filepath || '').startsWith('external://'),
    offlineAllowed: row.offline_allowed === 1,
    previewUrl: `/api/library/${row.id}/preview`,
    indexedAt: row.indexed_at,
  };

  if (isSubscriberTier(tier) || row.offline_allowed === 1) {
    base.downloadUrl = `/api/library/${row.id}/download`;
  }

  if (ctx) {
    base.unlocked = isUnlockedInContext(row, ctx);
    const price = ctx.prices.get(row.id);
    if (isVault && price) {
      base.price = {
        suggested: price.suggested_price,
        minimum: price.minimum_price,
        allowFree: price.allow_free === 1,
        paymentType: price.payment_type,
        recurringInterval: price.recurring_interval || null,
        currency: price.currency,
      };
    }
  }

  return base;
}

function getProjectId(mediaId) {
  const row = getDb().prepare(
    'SELECT project_id FROM vault_project_items WHERE content_id = ?'
  ).get(mediaId);
  return row?.project_id ?? null;
}

function unlinkIfExists(filepath) {
  try {
    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
  } catch {}
}

function buildPreviewArgs(row, isVideo, previewPath) {
  return isVideo
    ? [
        '-y',
        '-i', row.filepath,
        '-t', String(PREVIEW_DURATION),
        '-c:v', 'libx264',
        '-crf', '23',
        '-preset', 'fast',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-ac', '2',
        '-movflags', '+faststart',
        previewPath,
      ]
    : [
        '-y',
        '-i', row.filepath,
        '-t', String(PREVIEW_DURATION),
        '-vn',
        '-c:a', 'aac',
        '-b:a', '96k',
        '-ac', '2',
        previewPath,
      ];
}

function generatePreview(row, isVideo, previewPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, buildPreviewArgs(row, isVideo, previewPath), {
      stdio: 'ignore',
      windowsHide: true,
    });

    let settled = false;
    function settle(fn, value) {
      if (settled) return;
      settled = true;
      fn(value);
    }

    proc.on('error', err => {
      if (err.code === 'ENOENT') {
        settle(reject, new Error(`Preview generation unavailable. ${installHint()}`));
      } else {
        settle(reject, err);
      }
    });

    proc.on('close', code => {
      if (code === 0 && fs.existsSync(previewPath)) {
        settle(resolve);
        return;
      }
      unlinkIfExists(previewPath);
      settle(reject, new Error('Preview generation failed'));
    });
  });
}

function getPreviewJob(key, row, isVideo, previewPath) {
  let job = previewJobs.get(key);
  if (!job) {
    job = generatePreview(row, isVideo, previewPath)
      .finally(() => previewJobs.delete(key));
    previewJobs.set(key, job);
  }
  return job;
}

// Builds the 3 curated drawer slots: most recently active project, most
// played track, and the creator-chosen highlight. Computed here (rather than
// reusing the dashboard-only /api/analytics) so "most played" can be derived
// without exposing the gated analytics endpoint to the public player.
function buildCuratedSelection(db, projects, standalone) {
  const used = new Set();

  let recentProject = null;
  for (const p of [...projects].sort((a, b) => {
    const ad = a.tracks[0]?.indexedAt || '';
    const bd = b.tracks[0]?.indexedAt || '';
    return ad < bd ? 1 : ad > bd ? -1 : 0;
  })) {
    if (used.has(`project:${p.id}`)) continue;
    recentProject = p;
    used.add(`project:${p.id}`);
    break;
  }

  const allTrackItems = [...standalone, ...projects.flatMap(p => p.tracks)];
  const trackById = new Map(allTrackItems.map(t => [t.id, t]));

  const playCounts = db.prepare(
    'SELECT media_id, COUNT(*) AS plays FROM listen_events WHERE media_id IS NOT NULL GROUP BY media_id ORDER BY plays DESC'
  ).all();

  let mostPlayed = null;
  for (const row of playCounts) {
    const item = trackById.get(row.media_id);
    if (item && !used.has(`track:${item.id}`)) {
      mostPlayed = item;
      used.add(`track:${item.id}`);
      break;
    }
  }
  if (!mostPlayed) {
    for (const item of allTrackItems) {
      if (!used.has(`track:${item.id}`)) {
        mostPlayed = item;
        used.add(`track:${item.id}`);
        break;
      }
    }
  }

  let highlighted = null;
  const hl = db.prepare('SELECT highlight_type, highlight_id FROM highlight_config WHERE id = 1').get();
  if (hl?.highlight_type === 'track') {
    const item = trackById.get(hl.highlight_id);
    if (item && !used.has(`track:${item.id}`)) {
      highlighted = { type: 'track', item };
      used.add(`track:${item.id}`);
    }
  } else if (hl?.highlight_type === 'project') {
    const proj = projects.find(p => p.id === hl.highlight_id);
    if (proj && !used.has(`project:${proj.id}`)) {
      highlighted = { type: 'project', item: proj };
      used.add(`project:${proj.id}`);
    }
  }

  return { recentProject, mostPlayed, highlighted };
}

router.get('/structure', (req, res) => {
  const db = getDb();
  const { conditions, params } = buildMediaQuery({ tier: req.tier });
  const where = 'WHERE ' + conditions.join(' AND ');

  const allTracks = db.prepare(
    `SELECT m.* FROM media m ${where} ORDER BY m.indexed_at DESC`
  ).all(params);

  const projects = db.prepare('SELECT id, name, description FROM vault_projects ORDER BY created_at ASC').all();
  const ctx = buildOwnershipContext(req);
  const trackToProject = ctx.trackToProject;
  const projectMap = new Map(projects.map(p => [p.id, { ...p, tracks: [] }]));
  const standalone = [];

  for (const track of allTracks) {
    const projId = trackToProject.get(track.id);
    if (projId && projectMap.has(projId)) {
      projectMap.get(projId).tracks.push(formatItem(track, req.tier, ctx));
    } else {
      standalone.push(formatItem(track, req.tier, ctx));
    }
  }

  const result = {
    projects: [...projectMap.values()].filter(p => p.tracks.length > 0),
    standalone,
  };

  result.curated = buildCuratedSelection(db, result.projects, result.standalone);

  res.json(result);
});

router.get('/', (req, res) => {
  const { category, search, genre, page = '1', limit = '20' } = req.query;
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (pageNum - 1) * limitNum;

  const { conditions, params } = buildMediaQuery({ category, search, genre, tier: req.tier });
  const where = 'WHERE ' + conditions.join(' AND ');

  const db = getDb();
  const total = db.prepare(`SELECT COUNT(*) as n FROM media m ${where}`).get(params).n;
  const items = db.prepare(
    `SELECT * FROM media m ${where} ORDER BY m.indexed_at DESC LIMIT :limit OFFSET :offset`
  ).all({ ...params, limit: limitNum, offset });

  const ctx = buildOwnershipContext(req);
  res.json({
    items: items.map(r => formatItem(r, req.tier, ctx)),
    total,
    page: pageNum,
    limit: limitNum,
    pages: Math.ceil(total / limitNum),
  });
});

// GET /api/library/genres — distinct genres across items visible to this tier,
// for the browse chips. Vault items are discoverable, so their genres show too.
router.get('/genres', (req, res) => {
  const { conditions, params } = buildMediaQuery({ tier: req.tier });
  const where = 'WHERE ' + conditions.join(' AND ') + ' AND m.genre IS NOT NULL';
  const rows = getDb().prepare(
    `SELECT m.genre AS genre, COUNT(*) AS count FROM media m ${where}
     GROUP BY m.genre COLLATE NOCASE ORDER BY count DESC, genre ASC`
  ).all(params);
  res.json({ genres: rows });
});

// GET /api/library/discover?period=7d
// Public in-station discover feed: trending (by listened seconds over the
// window) and newest releases. Restricted to public items in SQL — vault and
// supporters-only content must never leak through an unauthenticated feed.
router.get('/discover', (req, res) => {
  const days = Math.min(90, Math.max(1, parseInt(req.query.period, 10) || 7));
  const db = getDb();

  const trendingRows = db.prepare(`
    SELECT m.*, COUNT(le.id) AS play_count, SUM(le.seconds) AS total_seconds
    FROM listen_events le
    JOIN media m ON m.id = le.media_id
    WHERE le.started_at >= datetime('now', :offset)
      AND m.is_active = 1 AND m.visibility = 'public'
    GROUP BY le.media_id
    ORDER BY total_seconds DESC
    LIMIT 10
  `).all({ offset: `-${days} days` });

  const newRows = db.prepare(`
    SELECT m.* FROM media m
    WHERE m.is_active = 1 AND m.visibility = 'public'
    ORDER BY m.indexed_at DESC
    LIMIT 10
  `).all();

  const ctx = buildOwnershipContext(req);
  res.json({
    periodDays: days,
    trending: trendingRows.map(r => ({ ...formatItem(r, req.tier, ctx), plays: r.play_count })),
    newReleases: newRows.map(r => formatItem(r, req.tier, ctx)),
  });
});

router.get('/stream-quota', (req, res) => {
  res.json(quotaStatus(req));
});

router.get('/:id/stream', streamLimiter, (req, res) => {
  const row = getDb().prepare(
    'SELECT * FROM media WHERE id = ? AND is_active = 1'
  ).get(req.params.id);

  if (!row || String(row.filepath || '').startsWith('external://')) {
    return res.status(404).json({ error: 'Not found' });
  }

  const projectId = getProjectId(row.id);
  const access = canAccessMedia(req, row, projectId);
  if (!access.allowed) {
    return res.status(403).json({ error: access.error, unlockOptions: normalizeUnlockOptions(access.unlockOptions) });
  }

  const ctx = buildOwnershipContext(req);
  const quotaExempt = isSubscriberTier(req.tier)
    || (row.visibility === 'vault' && isUnlockedInContext(row, ctx));

  if (!quotaExempt) {
    const quota = checkAndRecordPlay(req, row.id, { nextUp: req.query.nextUp === '1' });
    if (!quota.allowed) {
      return res.status(429).json({
        error: 'On-demand play limit reached',
        limit: quota.limit,
        remaining: 0,
        resetSec: quota.resetSec,
      });
    }
  }

  const filepath = safeVaultPath(row.filepath);
  if (!filepath) {
    return res.status(403).json({ error: 'File path is outside the vault' });
  }

  if (!fs.existsSync(filepath)) {
    return res.status(404).json({ error: 'File not found on disk' });
  }

  res.sendFile(filepath);
});

router.get('/:id', (req, res) => {
  const row = getDb().prepare(
    'SELECT * FROM media WHERE id = ? AND is_active = 1'
  ).get(req.params.id);

  if (!row) return res.status(404).json({ error: 'Not found' });

  const access = canAccessMedia(req, row, getProjectId(row.id));
  if (!access.allowed) {
    return res.status(403).json({ error: access.error, unlockOptions: normalizeUnlockOptions(access.unlockOptions) });
  }

  res.json(formatItem(row, req.tier, buildOwnershipContext(req)));
});

router.get('/:id/preview', previewLimiter, asyncHandler(async (req, res) => {
  // Public short previews are intentional for public/supporters_only items.
  // Vault previews stay unavailable until a separate paid-preview policy exists.
  const row = getDb().prepare(
    "SELECT * FROM media WHERE id = ? AND is_active = 1 AND visibility != 'vault'"
  ).get(req.params.id);

  if (!row) return res.status(404).json({ error: 'Not found' });

  const isVideo = row.mime_type && row.mime_type.startsWith('video/');
  const previewExt = isVideo ? 'mp4' : 'm4a';
  const previewPath = path.join(PREVIEW_DIR, `${row.id}.${previewExt}`);

  const altExt = isVideo ? 'm4a' : 'mp4';
  const altPath = path.join(PREVIEW_DIR, `${row.id}.${altExt}`);
  unlinkIfExists(altPath);

  if (fs.existsSync(previewPath)) {
    return res.sendFile(previewPath);
  }

  fs.mkdirSync(PREVIEW_DIR, { recursive: true });

  try {
    await getPreviewJob(`${row.id}:${previewExt}`, row, isVideo, previewPath);
    return res.sendFile(previewPath);
  } catch (err) {
    if (!res.headersSent) {
      const status = err.message.includes('unavailable') ? 503 : 500;
      res.status(status).json({ error: err.message });
    }
  }
}));

router.get('/:id/download', (req, res) => {
  if (!req.tokenRow) {
    return res.status(401).json({ error: 'Listener identity required to save this file' });
  }

  const row = getDb().prepare(
    'SELECT * FROM media WHERE id = ? AND is_active = 1'
  ).get(req.params.id);

  if (!row) return res.status(404).json({ error: 'Not found' });

  const access = canDownloadMedia(req, row, getProjectId(row.id));
  if (!access.allowed) {
    return res.status(403).json({ error: access.error, unlockOptions: normalizeUnlockOptions(access.unlockOptions) });
  }

  const filepath = safeVaultPath(row.filepath);
  if (!filepath) {
    return res.status(403).json({ error: 'File path is outside the vault' });
  }

  if (!fs.existsSync(filepath)) {
    return res.status(404).json({ error: 'File not found on disk' });
  }

  res.json(signDownloadUrl(row.id, { type: 'listener', tokenId: req.tokenRow?.id }));
});

router.get('/:id/artwork', (req, res) => {
  const row = getDb().prepare(
    'SELECT * FROM media WHERE id = ? AND is_active = 1'
  ).get(req.params.id);
  if (!row) return res.status(404).end();

  const access = canAccessMedia(req, row, getProjectId(row.id));
  if (!access.allowed) return res.status(403).end();

  const id = String(row.id);

  // Check for a manually uploaded artwork file first (overrides embedded + url)
  const uploaded = findUploadedArtwork(id);
  if (uploaded) {
    setImageHeaders(res, uploaded.mime);
    return res.end(fs.readFileSync(uploaded.filepath));
  }

  if (artworkCache.has(id)) {
    const buf = artworkCache.get(id);
    if (!buf) {
      if (row.artwork_url) return redirectArtworkUrl(res, row.artwork_url);
      return res.status(404).end();
    }
    setImageHeaders(res, 'image/jpeg');
    return res.end(buf);
  }

  const filepath = safeVaultPath(row.filepath);
  if (!filepath || !fs.existsSync(filepath)) {
    artworkCache.set(id, null);
    if (row.artwork_url) return redirectArtworkUrl(res, row.artwork_url);
    return res.status(404).end();
  }

  if (artworkPending.has(id)) {
    artworkPending.get(id).push(res);
    return;
  }
  artworkPending.set(id, [res]);

  const chunks = [];
  const proc = spawn(ffmpegPath, [
    '-i', filepath,
    '-map', '0:v:0',
    '-vframes', '1',
    '-f', 'image2pipe',
    '-vcodec', 'mjpeg',
    '-',
  ], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });

  proc.stdout.on('data', chunk => chunks.push(chunk));

  function finish(buf) {
    const pending = artworkPending.get(id) || [];
    artworkPending.delete(id);
    if (!buf && row.artwork_url) {
      // Fall back to the manually specified artwork URL
      for (const r of pending) redirectArtworkUrl(r, row.artwork_url);
      return;
    }
    if (artworkCache.size >= MAX_ARTWORK_CACHE) {
      artworkCache.delete(artworkCache.keys().next().value);
    }
    artworkCache.set(id, buf);
    for (const r of pending) {
      if (!buf) { r.status(404).end(); continue; }
      setImageHeaders(r, 'image/jpeg');
      r.end(buf);
    }
  }

  proc.on('close', code => {
    if (code !== 0 || chunks.length === 0) return finish(null);
    finish(Buffer.concat(chunks));
  });
  proc.on('error', () => finish(null));
});

router.get('/:id/file', (req, res) => {
  const { exp, sig } = req.query;
  const ctx = typeof req.query.ctx === 'string' ? req.query.ctx : 'legacy';

  if (!verifyDownloadSig(req.params.id, exp, sig, ctx)) {
    return res.status(403).json({ error: 'Invalid or expired download link' });
  }

  const db = getDb();
  const row = db.prepare(
    'SELECT * FROM media WHERE id = ? AND is_active = 1'
  ).get(req.params.id);

  if (!row) {
    return res.status(404).json({ error: 'File not found' });
  }

  if (!signedDownloadAllowed(db, row, ctx)) {
    return res.status(403).json({ error: 'Download access no longer valid' });
  }

  const filepath = safeVaultPath(row.filepath);
  if (!filepath) {
    return res.status(403).json({ error: 'File path is outside the vault' });
  }

  if (!fs.existsSync(filepath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  res.download(filepath, path.basename(filepath));
});

module.exports = router;
module.exports.clearArtworkCache = clearArtworkCache;
module.exports.ARTWORK_DIR = ARTWORK_DIR;
module.exports.formatItem = formatItem;
module.exports.signDownloadUrl = signDownloadUrl;
module.exports.buildOwnershipContext = buildOwnershipContext;
module.exports.isUnlockedInContext = isUnlockedInContext;
