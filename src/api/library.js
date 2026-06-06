const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { getDb } = require('../db');
const { isSubscriberTier, canAccessMedia, canDownloadMedia } = require('../auth/access');
const config = require('../config');

const PREVIEW_DIR = path.join(config.paths.hlsOutput, 'previews');
const PREVIEW_DURATION = 60;

function signingSecret() {
  return config.auth.downloadSigningSecret;
}

function signDownloadUrl(mediaId) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const sig = crypto.createHmac('sha256', signingSecret())
    .update(`${mediaId}:${exp}`)
    .digest('hex');
  return {
    signedUrl: `/api/library/${mediaId}/file?exp=${exp}&sig=${sig}`,
    expiresAt: new Date(exp * 1000).toISOString(),
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

function parseTags(tags) {
  if (!tags) return [];
  try {
    const parsed = JSON.parse(tags);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function buildMediaQuery({ category, search, tier }) {
  const conditions = ['m.is_active = 1'];
  const params = {};

  // Vault items are discoverable for everyone so the UI can show locked items.
  if (isSubscriberTier(tier)) {
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
    artist:   row.artist   || null,
    album:    row.album    || null,
    producer: row.producer || null,
    credits:  row.credits  || null,
    category: row.category,
    duration: row.duration,
    bpm: row.bpm || null,
    tags: parseTags(row.tags),
    visibility: row.visibility,
    mimeType: row.mime_type || null,
    isVideo,
    isVault,
    previewUrl: `/api/library/${row.id}/preview`,
    indexedAt: row.indexed_at,
  };

  if (isSubscriberTier(tier)) {
    base.downloadUrl = `/api/library/${row.id}/download`;
  }

  return base;
}

function getProjectId(mediaId) {
  const row = getDb().prepare(
    'SELECT project_id FROM vault_project_items WHERE content_id = ?'
  ).get(mediaId);
  return row?.project_id ?? null;
}

router.get('/structure', (req, res) => {
  const db = getDb();
  const { conditions, params } = buildMediaQuery({ tier: req.tier });
  const where = 'WHERE ' + conditions.join(' AND ');

  const allTracks = db.prepare(
    `SELECT m.* FROM media m ${where} ORDER BY m.indexed_at DESC`
  ).all(params);

  const projects = db.prepare('SELECT id, name, description FROM vault_projects ORDER BY created_at ASC').all();
  const projectItems = db.prepare('SELECT project_id, content_id FROM vault_project_items').all();

  const trackToProject = new Map(projectItems.map(pi => [pi.content_id, pi.project_id]));
  const projectMap = new Map(projects.map(p => [p.id, { ...p, tracks: [] }]));
  const standalone = [];

  for (const track of allTracks) {
    const projId = trackToProject.get(track.id);
    if (projId && projectMap.has(projId)) {
      projectMap.get(projId).tracks.push(formatItem(track, req.tier));
    } else {
      standalone.push(formatItem(track, req.tier));
    }
  }

  res.json({
    projects: [...projectMap.values()].filter(p => p.tracks.length > 0),
    standalone,
  });
});

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

router.get('/:id', (req, res) => {
  const row = getDb().prepare(
    'SELECT * FROM media WHERE id = ? AND is_active = 1'
  ).get(req.params.id);

  if (!row) return res.status(404).json({ error: 'Not found' });

  const access = canAccessMedia(req, row, getProjectId(row.id));
  if (!access.allowed) {
    return res.status(403).json({ error: access.error, unlockOptions: access.unlockOptions });
  }

  res.json(formatItem(row, req.tier));
});

router.get('/:id/preview', (req, res) => {
  const row = getDb().prepare(
    "SELECT * FROM media WHERE id = ? AND is_active = 1 AND visibility != 'vault'"
  ).get(req.params.id);

  if (!row) return res.status(404).json({ error: 'Not found' });

  const isVideo = row.mime_type && row.mime_type.startsWith('video/');
  const previewExt = isVideo ? 'mp4' : 'm4a';
  const previewPath = path.join(PREVIEW_DIR, `${row.id}.${previewExt}`);

  const altExt = isVideo ? 'm4a' : 'mp4';
  const altPath = path.join(PREVIEW_DIR, `${row.id}.${altExt}`);
  if (fs.existsSync(altPath)) fs.unlinkSync(altPath);

  if (fs.existsSync(previewPath)) {
    return res.sendFile(previewPath);
  }

  fs.mkdirSync(PREVIEW_DIR, { recursive: true });

  const args = isVideo
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

router.get('/:id/download', (req, res) => {
  const row = getDb().prepare(
    'SELECT * FROM media WHERE id = ? AND is_active = 1'
  ).get(req.params.id);

  if (!row) return res.status(404).json({ error: 'Not found' });

  const access = canDownloadMedia(req, row, getProjectId(row.id));
  if (!access.allowed) {
    return res.status(403).json({ error: access.error, unlockOptions: access.unlockOptions });
  }

  if (!fs.existsSync(row.filepath)) {
    return res.status(404).json({ error: 'File not found on disk' });
  }

  res.json(signDownloadUrl(row.id));
});

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
