const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { getDb } = require('../db');
const { requireSubscriber } = require('../auth/middleware');
const { canAccessVaultContent } = require('../auth/vault');
const config = require('../config');

const PREVIEW_DIR = path.join(config.paths.hlsOutput, 'previews');
const PREVIEW_DURATION = 60;

// Tiers that may access supporters_only content
const SUBSCRIBER_TIERS = new Set(['subscriber', 'pro', 'all_access']);

// ─── HMAC-signed download URLs ────────────────────────────────────────────────
// Signed URLs are valid for 1 hour. Secret is DOWNLOAD_SIGNING_SECRET, which
// is auto-generated at startup when not set, so it never leaks DASHBOARD_TOKEN.

function signingSecret() {
  return config.auth.downloadSigningSecret;
}

function signDownloadUrl(mediaId) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const sig = crypto.createHmac('sha256', signingSecret())
    .update(`${mediaId}:${exp}`)
    .digest('hex');
  return {
    signedUrl:  `/api/library/${mediaId}/file?exp=${exp}&sig=${sig}`,
    expiresAt:  new Date(exp * 1000).toISOString(),
  };
}

function verifyDownloadSig(mediaId, exp, sig) {
  const now = Math.floor(Date.now() / 1000);
  if (!exp || !sig || parseInt(exp, 10) < now) return false;
  const expected = crypto.createHmac('sha256', signingSecret())
    .update(`${mediaId}:${exp}`)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildMediaQuery({ category, search, tier }) {
  const conditions = ['m.is_active = 1'];
  const params = {};

  // Vault items are always discoverable (shown with lock UI) — included for all tiers.
  // Free tier: public + vault. Subscriber tiers: public + supporters_only + vault.
  if (SUBSCRIBER_TIERS.has(tier)) {
    conditions.push("m.visibility IN ('public', 'supporters_only', 'vault')");
  } else {
    conditions.push("m.visibility IN ('public', 'vault')");
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
  const isVideo = !!(row.mime_type && row.mime_type.startsWith('video/'));
  const isVault = row.visibility === 'vault';
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
    mimeType: row.mime_type || null,
    isVideo,
    isVault,
    previewUrl: `/api/library/${row.id}/preview`,
    indexedAt: row.indexed_at,
  };

  if (tier === 'subscriber') {
    base.downloadUrl = `/api/library/${row.id}/download`;
  }

  return base;
}

// Returns true if the request carries a scoped token that grants access to
// this specific media item (by track id or by its project id).
function hasScopedVaultAccess(req, mediaId, projectId) {
  const tok = req.tokenRow;
  if (!tok || !tok.scope_type) return false;
  if (tok.scope_type === 'track'   && Number(tok.scope_id) === Number(mediaId))   return true;
  if (tok.scope_type === 'project' && Number(tok.scope_id) === Number(projectId)) return true;
  return false;
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// GET /api/library/structure
// Returns tracks organised into projects + a standalone list.
// Must be defined before /:id so Express doesn't treat 'structure' as an id.
router.get('/structure', (req, res) => {
  const db = getDb();
  const { conditions, params } = buildMediaQuery({ tier: req.tier });
  const where = 'WHERE ' + conditions.join(' AND ');

  const allTracks = db.prepare(
    `SELECT m.* FROM media m ${where} ORDER BY m.indexed_at DESC`
  ).all(params);

  const projects  = db.prepare('SELECT id, name, description FROM vault_projects ORDER BY created_at ASC').all();
  const projectItems = db.prepare('SELECT project_id, content_id FROM vault_project_items').all();

  const trackToProject = new Map(projectItems.map(pi => [pi.content_id, pi.project_id]));
  const projectMap     = new Map(projects.map(p => [p.id, { ...p, tracks: [] }]));
  const standalone     = [];

  for (const track of allTracks) {
    const projId = trackToProject.get(track.id);
    if (projId && projectMap.has(projId)) {
      projectMap.get(projId).tracks.push(formatItem(track, req.tier));
    } else {
      standalone.push(formatItem(track, req.tier));
    }
  }

  res.json({
    projects:   [...projectMap.values()].filter(p => p.tracks.length > 0),
    standalone,
  });
});

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

  // Fetch project membership once — used by both access checks below
  const projectMembership = getDb().prepare(
    'SELECT project_id FROM vault_project_items WHERE content_id = ?'
  ).get(row.id);
  const projectId = projectMembership?.project_id ?? null;

  // supporters_only — subscriber tier or a scoped token for this track/project
  if (row.visibility === 'supporters_only') {
    if (!SUBSCRIBER_TIERS.has(req.tier) && !hasScopedVaultAccess(req, row.id, projectId)) {
      return res.status(403).json({ error: 'Supporter access required' });
    }
  }

  // vault — scoped token, vault unlock, or all_access bypass
  if (row.visibility === 'vault') {
    if (!hasScopedVaultAccess(req, row.id, projectId)) {
      const listenerId = req.tokenRow?.listener_id || null;
      const result = canAccessVaultContent(listenerId, row.id);
      if (!result.allowed) {
        return res.status(403).json({ error: 'Vault access required', unlockOptions: result.unlockOptions });
      }
    }
  }

  res.json(formatItem(row, req.tier));
});

// GET /api/library/:id/preview
// For audio files: generates a 60-second AAC clip (.m4a).
// For video files: generates a 60-second H.264/AAC clip (.mp4).
// Caches the result; serves cached file on subsequent requests.
// Intentional: supporters_only items return a preview for free-tier listeners.
// The teaser is the conversion mechanic — hearing 60 seconds drives upgrade clicks.
// Vault items are excluded — no preview served for gated content.
router.get('/:id/preview', (req, res) => {
  const row = getDb().prepare(
    "SELECT * FROM media WHERE id = ? AND is_active = 1 AND visibility != 'vault'"
  ).get(req.params.id);

  if (!row) return res.status(404).json({ error: 'Not found' });

  const isVideo = row.mime_type && row.mime_type.startsWith('video/');
  const previewExt  = isVideo ? 'mp4' : 'm4a';
  const previewPath = path.join(PREVIEW_DIR, `${row.id}.${previewExt}`);

  // Also check for the other extension (in case mime_type changed after re-index)
  const altExt  = isVideo ? 'm4a' : 'mp4';
  const altPath = path.join(PREVIEW_DIR, `${row.id}.${altExt}`);
  if (fs.existsSync(altPath)) fs.unlinkSync(altPath);

  // Serve cached preview if it exists
  if (fs.existsSync(previewPath)) {
    return res.sendFile(previewPath);
  }

  fs.mkdirSync(PREVIEW_DIR, { recursive: true });

  // Build FFmpeg args depending on source type
  let args;
  if (isVideo) {
    args = [
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
    ];
  } else {
    args = [
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

  const proc = spawn('ffmpeg', args, { stdio: 'ignore', windowsHide: true });

  proc.on('error', err => {
    if (!res.headersSent) {
      res.status(503).json({ error: 'Preview generation unavailable (ffmpeg not installed)' });
    }
  });

  proc.on('close', code => {
    if (code === 0 && fs.existsSync(previewPath)) {
      res.sendFile(previewPath);
    } else {
      if (fs.existsSync(previewPath)) fs.unlinkSync(previewPath);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Preview generation failed' });
      }
    }
  });
});

// GET /api/library/:id/download
// Returns a signed URL — never serves the raw file directly.
// Vault items use canAccessVaultContent(); all others use requireSubscriber gate.
router.get('/:id/download', (req, res) => {
  const row = getDb().prepare(
    'SELECT * FROM media WHERE id = ? AND is_active = 1'
  ).get(req.params.id);

  if (!row) return res.status(404).json({ error: 'Not found' });

  if (row.visibility === 'vault') {
    const listenerId = req.tokenRow?.listener_id || null;
    const result = canAccessVaultContent(listenerId, row.id);
    if (!result.allowed) {
      return res.status(403).json({ error: 'Vault access required', unlockOptions: result.unlockOptions });
    }
  } else {
    // Non-vault content: subscriber tier required
    if (!SUBSCRIBER_TIERS.has(req.tier)) {
      return res.status(403).json({ error: 'Subscriber access required' });
    }
  }

  if (!fs.existsSync(row.filepath)) {
    return res.status(404).json({ error: 'File not found on disk' });
  }

  res.json(signDownloadUrl(row.id));
});

// GET /api/library/:id/file?exp=UNIX_TS&sig=HMAC
// Validates the HMAC signature issued by the download route and streams the file.
// No auth header required — the HMAC is the auth mechanism.
router.get('/:id/file', (req, res) => {
  const { exp, sig } = req.query;

  if (!verifyDownloadSig(req.params.id, exp, sig)) {
    return res.status(403).json({ error: 'Invalid or expired download link' });
  }

  const row = getDb().prepare(
    'SELECT * FROM media WHERE id = ? AND is_active = 1'
  ).get(req.params.id);

  if (!row || !fs.existsSync(row.filepath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  res.download(row.filepath, path.basename(row.filepath));
});

module.exports = router;
