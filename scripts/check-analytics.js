#!/usr/bin/env node
// Verifies listener pings create listen_events and daily_stats rows.

process.env.PAPERWEIGHT_ALLOW_MISSING_ENV = 'true';

const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paperweight-analytics-'));
process.env.DATA_PATH = path.join(tempDir, 'data');
process.env.HLS_OUTPUT_PATH = path.join(tempDir, 'hls_output');

const { initDb, closeDb, getDb } = require('../src/db');

try {
  fs.mkdirSync(process.env.HLS_OUTPUT_PATH, { recursive: true });
  initDb();

  const db = getDb();
  const media = db.prepare(`
    INSERT INTO media (filepath, filename, category, title, duration, visibility)
    VALUES (?, ?, ?, ?, ?, 'public')
  `).run(path.join(tempDir, 'track.mp3'), 'track.mp3', 'music', 'Smoke Track', 120);

  fs.writeFileSync(path.join(process.env.HLS_OUTPUT_PATH, 'state.json'), JSON.stringify({
    isLive: true,
    mode: 'shuffle',
    nowPlaying: {
      id: media.lastInsertRowid,
      title: 'Smoke Track',
      startedAt: new Date().toISOString(),
    },
  }), 'utf8');

  const stream = require('../src/api/stream');
  const req = {
    ip: '127.0.0.1',
    tier: 'free',
    headers: { 'user-agent': 'paperweight-analytics-check' },
  };

  stream.recordPing(req);
  stream.recordPing(req);

  const event = db.prepare('SELECT * FROM listen_events WHERE media_id = ?').get(media.lastInsertRowid);
  if (!event) throw new Error('listen_events row was not created');
  if (event.seconds < 1) throw new Error(`listen_events.seconds was not incremented (${event.seconds})`);

  const stats = db.prepare('SELECT * FROM daily_stats WHERE date = ?').get(new Date().toISOString().slice(0, 10));
  if (!stats) throw new Error('daily_stats row was not created');
  if (stats.unique_listeners !== 1) throw new Error(`expected 1 unique listener, got ${stats.unique_listeners}`);
  if (stats.total_listen_sec < 1) throw new Error(`expected positive listen seconds, got ${stats.total_listen_sec}`);
  if (stats.top_media_id !== media.lastInsertRowid) throw new Error('top_media_id does not match listened media');

  console.log('Analytics check passed.');
} catch (err) {
  console.error(`Analytics check failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  try { closeDb(); } catch {}
  fs.rmSync(tempDir, { recursive: true, force: true });
}
