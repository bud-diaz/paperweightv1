// Release scheduler: polls for media and creator posts whose scheduled
// release time has arrived and flips their state, firing notify.
//
// This is unrelated to src/broadcast/scheduler.js, which resolves the live
// FFmpeg broadcast's weekly dayparting blocks — that "scheduler" governs what
// plays on the station right now, not when content becomes public.
//
// Best-effort like the rest of src/notify/: a bad tick must never crash the
// server, so every DB/notify call here is wrapped and logged.

const { getDb, log } = require('../db');
const notify = require('../notify');

const POLL_INTERVAL_MS = 30 * 1000;

let timer = null;

function releaseDueMedia() {
  const rows = getDb().prepare(`
    UPDATE media
    SET visibility = 'public', release_at = NULL
    WHERE release_at IS NOT NULL AND release_at <= datetime('now') AND is_active = 1
    RETURNING id, title, filename
  `).all();

  for (const media of rows) {
    try {
      notify.mediaReleased(media);
    } catch (err) {
      log('warn', 'release', `mediaReleased notify failed for media ${media.id}: ${err.message}`);
    }
  }
}

function announceDuePosts() {
  const db = getDb();
  const due = db.prepare(`
    SELECT id, title, body, visibility, notify_supporters
    FROM creator_posts
    WHERE release_notified_at IS NULL AND published_at <= datetime('now')
  `).all();

  for (const post of due) {
    try {
      notify.postPublished(post, { emailSupporters: !!post.notify_supporters });
    } catch (err) {
      log('warn', 'release', `postPublished notify failed for post ${post.id}: ${err.message}`);
    }
    db.prepare(`UPDATE creator_posts SET release_notified_at = datetime('now') WHERE id = ?`).run(post.id);
  }
}

function tick() {
  try {
    releaseDueMedia();
  } catch (err) {
    log('error', 'release', `Media release check failed: ${err.message}`);
  }
  try {
    announceDuePosts();
  } catch (err) {
    log('error', 'release', `Post release check failed: ${err.message}`);
  }
}

function start() {
  if (timer) return;
  tick();
  timer = setInterval(tick, POLL_INTERVAL_MS);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, tick };
