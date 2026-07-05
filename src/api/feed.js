// Public RSS feed (podcast-app compatible) for PUBLIC vault media.
// Off by default; the creator enables it from dashboard settings
// (feed_enabled), choosing whether it carries only the podcasts category or
// every public item (feed_scope: 'podcasts' | 'all').
//
// Enclosures are served by /feed/enclosure/:id — public items only, and only
// while the feed is enabled, so turning the feed off also kills the URLs that
// podcast apps have cached. Gated and supporters-only media never appear here.

const path = require('path');
const fs = require('fs');
const { getDb } = require('../db');
const { getBoolSetting, getSetting } = require('../db/settings');
const { safeVaultPath } = require('./safeVaultPath');
const { publicBaseUrl } = require('../runtime/base-url');
const config = require('../config');

const FEED_ITEM_LIMIT = 100;

function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function feedItems(db) {
  const scope = getSetting('feed_scope') || 'podcasts';
  const categoryFilter = scope === 'all' ? '' : "AND category = 'podcasts'";
  // External (YouTube/SoundCloud) rows have no local file to enclose.
  return db.prepare(`
    SELECT * FROM media
    WHERE is_active = 1 AND visibility = 'public'
      AND filepath NOT LIKE 'external://%'
      ${categoryFilter}
    ORDER BY indexed_at DESC
    LIMIT ${FEED_ITEM_LIMIT}
  `).all();
}

function itunesDuration(seconds) {
  const total = Math.max(0, Math.round(seconds || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// GET /feed.xml
function feedXml(req, res) {
  if (!getBoolSetting('feed_enabled', false)) {
    return res.status(404).type('text/plain').send('Feed not enabled');
  }

  const db = getDb();
  const base = publicBaseUrl(req);
  const station = config.station.name || 'Paperweight Station';
  const description = config.station.creatorDesc || `${station} — powered by Paperweight`;

  const items = feedItems(db).map(row => {
    const title = row.title || row.filename;
    const url = `${base}/feed/enclosure/${row.id}`;
    // indexed_at is SQLite datetime('now') — UTC without a zone suffix.
    const pubDate = new Date(row.indexed_at.endsWith('Z') ? row.indexed_at : `${row.indexed_at}Z`).toUTCString();
    return [
      '    <item>',
      `      <title>${xmlEscape(title)}</title>`,
      row.artist ? `      <itunes:author>${xmlEscape(row.artist)}</itunes:author>` : null,
      `      <guid isPermaLink="false">paperweight-media-${row.id}</guid>`,
      `      <pubDate>${pubDate}</pubDate>`,
      `      <enclosure url="${xmlEscape(url)}" length="${row.file_size || 0}" type="${xmlEscape(row.mime_type || 'audio/mpeg')}"/>`,
      row.duration ? `      <itunes:duration>${itunesDuration(row.duration)}</itunes:duration>` : null,
      '    </item>',
    ].filter(Boolean).join('\n');
  });

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom">',
    '  <channel>',
    `    <title>${xmlEscape(station)}</title>`,
    `    <link>${xmlEscape(base)}</link>`,
    `    <description>${xmlEscape(description)}</description>`,
    '    <language>en</language>',
    `    <atom:link href="${xmlEscape(`${base}/feed.xml`)}" rel="self" type="application/rss+xml"/>`,
    `    <generator>Paperweight ${config.version}</generator>`,
    items.join('\n'),
    '  </channel>',
    '</rss>',
    '',
  ].join('\n');

  res.setHeader('Content-Type', 'application/rss+xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.send(xml);
}

// GET /feed/enclosure/:id — public feed items only, Range-capable for podcast apps.
function enclosure(req, res) {
  if (!getBoolSetting('feed_enabled', false)) {
    return res.status(404).json({ error: 'Feed not enabled' });
  }

  const db = getDb();
  const scope = getSetting('feed_scope') || 'podcasts';
  const row = db.prepare(
    "SELECT * FROM media WHERE id = ? AND is_active = 1 AND visibility = 'public'"
  ).get(req.params.id);
  if (!row || row.filepath.startsWith('external://')) {
    return res.status(404).json({ error: 'Not found' });
  }
  if (scope !== 'all' && row.category !== 'podcasts') {
    return res.status(404).json({ error: 'Not found' });
  }

  const filepath = safeVaultPath(row.filepath);
  if (!filepath || !fs.existsSync(filepath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  res.setHeader('Content-Type', row.mime_type || 'application/octet-stream');
  res.sendFile(filepath, err => {
    if (err && !res.headersSent) res.status(500).end();
  });
}

module.exports = { feedXml, enclosure };
