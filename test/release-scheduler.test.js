process.env.PAPERWEIGHT_ALLOW_MISSING_ENV = 'true';
process.env.DASHBOARD_TOKEN = 'test-dashboard-token';
process.env.DOWNLOAD_SIGNING_SECRET = 'test-download-secret';

const test = require('node:test');
const assert = require('node:assert/strict');

const { freshDb, seedMedia, futureIso, pastIso } = require('./helpers');
const { createApp } = require('../src/index');
const releaseScheduler = require('../src/release/scheduler');

async function withServer(fn) {
  const app = createApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(baseUrl);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function request(baseUrl, pathname, options = {}) {
  const res = await fetch(`${baseUrl}${pathname}`, options);
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch {}
  return { res, body, text };
}

const auth = { 'X-Dashboard-Token': process.env.DASHBOARD_TOKEN, 'Content-Type': 'application/json' };

test('PATCH media rejects a past or invalid release_at', async () => {
  const db = freshDb();
  const media = seedMedia(db, { visibility: 'vault' });
  await withServer(async baseUrl => {
    const past = await request(baseUrl, `/api/dashboard/media/${media.id}`, {
      method: 'PATCH', headers: auth, body: JSON.stringify({ release_at: pastIso() }),
    });
    assert.equal(past.res.status, 400);

    const invalid = await request(baseUrl, `/api/dashboard/media/${media.id}`, {
      method: 'PATCH', headers: auth, body: JSON.stringify({ release_at: 'not-a-date' }),
    });
    assert.equal(invalid.res.status, 400);
  });
});

test('PATCH media accepts a future release_at and clears it when going public', async () => {
  const db = freshDb();
  const media = seedMedia(db, { visibility: 'vault' });
  await withServer(async baseUrl => {
    const future = futureIso();
    const ok = await request(baseUrl, `/api/dashboard/media/${media.id}`, {
      method: 'PATCH', headers: auth, body: JSON.stringify({ release_at: future }),
    });
    assert.equal(ok.res.status, 200);
    let row = db.prepare('SELECT * FROM media WHERE id = ?').get(media.id);
    assert.ok(row.release_at);
    assert.equal(row.visibility, 'vault');

    // Explicitly setting visibility to public supersedes any pending schedule.
    const goPublic = await request(baseUrl, `/api/dashboard/media/${media.id}`, {
      method: 'PATCH', headers: auth, body: JSON.stringify({ visibility: 'public' }),
    });
    assert.equal(goPublic.res.status, 200);
    row = db.prepare('SELECT * FROM media WHERE id = ?').get(media.id);
    assert.equal(row.visibility, 'public');
    assert.equal(row.release_at, null);
  });
});

test('release scheduler tick flips due media to public and leaves future ones untouched', () => {
  const db = freshDb();
  const due = seedMedia(db, { visibility: 'vault', title: 'Due track' });
  const notDue = seedMedia(db, { visibility: 'vault', title: 'Future track' });
  db.prepare("UPDATE media SET release_at = datetime('now', '-1 minute') WHERE id = ?").run(due.id);
  db.prepare("UPDATE media SET release_at = datetime('now', '+1 day') WHERE id = ?").run(notDue.id);

  releaseScheduler.tick();

  const dueRow = db.prepare('SELECT * FROM media WHERE id = ?').get(due.id);
  assert.equal(dueRow.visibility, 'public');
  assert.equal(dueRow.release_at, null);

  const notDueRow = db.prepare('SELECT * FROM media WHERE id = ?').get(notDue.id);
  assert.equal(notDueRow.visibility, 'vault');
  assert.ok(notDueRow.release_at);
});

test('creating a post with a future published_at does not notify immediately', async () => {
  const db = freshDb();
  await withServer(async baseUrl => {
    const created = await request(baseUrl, '/api/dashboard/posts', {
      method: 'POST', headers: auth,
      body: JSON.stringify({ body: 'Scheduled post', published_at: futureIso() }),
    });
    assert.equal(created.res.status, 201);
    assert.equal(created.body.release_notified_at, null);

    const row = db.prepare('SELECT * FROM creator_posts WHERE id = ?').get(created.body.id);
    assert.equal(row.release_notified_at, null);
  });
});

test('creating a post with no published_at publishes immediately (unchanged behavior)', async () => {
  freshDb();
  await withServer(async baseUrl => {
    const created = await request(baseUrl, '/api/dashboard/posts', {
      method: 'POST', headers: auth,
      body: JSON.stringify({ body: 'Immediate post' }),
    });
    assert.equal(created.res.status, 201);
    assert.ok(created.body.release_notified_at);
  });
});

test('release scheduler tick announces a due scheduled post exactly once', () => {
  const db = freshDb();
  const info = db.prepare(`
    INSERT INTO creator_posts (title, body, visibility, published_at, notify_supporters)
    VALUES ('Scheduled', 'body text', 'public', datetime('now', '-1 minute'), 0)
  `).run();

  releaseScheduler.tick();
  let row = db.prepare('SELECT * FROM creator_posts WHERE id = ?').get(info.lastInsertRowid);
  assert.ok(row.release_notified_at);
  const firstNotifiedAt = row.release_notified_at;

  // A second tick must not re-stamp or re-announce.
  releaseScheduler.tick();
  row = db.prepare('SELECT * FROM creator_posts WHERE id = ?').get(info.lastInsertRowid);
  assert.equal(row.release_notified_at, firstNotifiedAt);
});
