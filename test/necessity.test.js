process.env.PAPERWEIGHT_ALLOW_MISSING_ENV = 'true';
process.env.DASHBOARD_TOKEN = 'test-dashboard-token';

const test = require('node:test');
const assert = require('node:assert/strict');
const { freshDb, seedMedia, seedListener, seedToken, futureIso } = require('./helpers');
const { createApp } = require('../src/index');

const DASH = { 'X-Dashboard-Token':'test-dashboard-token', 'Content-Type':'application/json' };

async function withServer(fn) {
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try { await fn(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

async function request(base, path, options = {}) {
  const res = await fetch(`${base}${path}`, options);
  const body = await res.json().catch(() => null);
  return { res, body };
}

function profileAndToken(db, email = 'listener@example.com') {
  const listenerId = Number(seedListener(db, email));
  const token = seedToken(db, { listenerId });
  const info = db.prepare('INSERT INTO listener_profiles (display_name,email,marketing_opt_in,account_id,token_id) VALUES (?,?,?,?,?)')
    .run('Known Listener', email, 1, listenerId, token.id);
  return { listenerId, profileId:Number(info.lastInsertRowid), token };
}

test('Audience Memory accepts allowlisted player events and exposes a relationship timeline', async () => {
  const db = freshDb();
  const media = seedMedia(db, { title:'Signal Track' });
  const identity = profileAndToken(db);
  await withServer(async base => {
    const event = await request(base, '/api/events', {
      method:'POST', headers:{ Authorization:`Bearer ${identity.token.token}`, 'Content-Type':'application/json' },
      body:JSON.stringify({ type:'on_demand_started', mediaId:media.id, source:'library' }),
    });
    assert.equal(event.res.status, 202);
    assert.ok(event.body.id);

    const rejected = await request(base, '/api/events', {
      method:'POST', headers:{ Authorization:`Bearer ${identity.token.token}`, 'Content-Type':'application/json' },
      body:JSON.stringify({ type:'unlock_completed', mediaId:media.id }),
    });
    assert.equal(rejected.res.status, 400);

    const people = await request(base, '/api/dashboard/audience-memory/people', { headers:DASH });
    assert.equal(people.res.status, 200);
    assert.equal(people.body.people[0].display_name, 'Known Listener');
    const person = await request(base, `/api/dashboard/audience-memory/people/${identity.profileId}`, { headers:DASH });
    assert.equal(person.body.timeline[0].type, 'on_demand_started');

    const today = await request(base, '/api/dashboard/today', { headers:DASH });
    assert.equal(today.res.status, 200);
    assert.ok(Array.isArray(today.body.insights));
    assert.deepEqual(Object.keys(today.body.outcomes), ['returningListeners','optIns','payments','releases']);
  });
});
test('Release Autopilot schedules one durable job and publishes its coordinated actions once', async () => {
  const db = freshDb();
  const media = seedMedia(db, { title:'Future Single', visibility:'vault' });
  await withServer(async base => {
    const created = await request(base, '/api/dashboard/releases', {
      method:'POST', headers:DASH, body:JSON.stringify({
        title:'Future Single', releaseAt:futureIso(), visibility:'public', itemIds:[media.id],
        postTitle:'Out now', postBody:'The new single has landed.', setHighlight:true,
        notifyWebhook:false, notifySupporters:false, queuePremiere:false,
      }),
    });
    assert.equal(created.res.status, 201);
    assert.equal(created.body.status, 'scheduled');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM background_jobs WHERE job_type='release.publish'").get().n, 1);

    const published = await request(base, `/api/dashboard/releases/${created.body.id}/publish`, { method:'POST', headers:DASH, body:'{}' });
    assert.equal(published.res.status, 200);
    assert.equal(published.body.status, 'published');
    assert.equal(db.prepare('SELECT visibility FROM media WHERE id=?').get(media.id).visibility, 'public');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM creator_posts').get().n, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audience_events WHERE event_type='release_published'").get().n, 1);

    await request(base, `/api/dashboard/releases/${created.body.id}/publish`, { method:'POST', headers:DASH, body:'{}' });
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM creator_posts').get().n, 1);
    const report = await request(base, `/api/dashboard/releases/${created.body.id}/report`, { headers:DASH });
    assert.equal(report.res.status, 200);
    assert.equal(report.body.plays, 0);
  });
});

test('Participation is bounded per listener and creator moderation controls are authenticated', async () => {
  const db = freshDb();
  const media = seedMedia(db, { title:'Requestable', visibility:'public' });
  const identity = profileAndToken(db, 'participant@example.com');
  await withServer(async base => {
    const unauth = await request(base, '/api/dashboard/participation/polls');
    assert.equal(unauth.res.status, 401);
    const poll = await request(base, '/api/dashboard/participation/polls', {
      method:'POST', headers:DASH, body:JSON.stringify({ question:'What should play next?', options:['A side','B side'] }),
    });
    assert.equal(poll.res.status, 201);
    await request(base, `/api/dashboard/participation/polls/${poll.body.id}/status`, { method:'PUT', headers:DASH, body:JSON.stringify({ status:'open' }) });
    const active = await request(base, '/api/participation');
    const optionId = active.body.polls[0].options[0].id;
    const listenerHeaders = { Authorization:`Bearer ${identity.token.token}`, 'Content-Type':'application/json' };
    const vote = await request(base, `/api/participation/polls/${poll.body.id}/vote`, { method:'POST', headers:listenerHeaders, body:JSON.stringify({ optionId }) });
    assert.equal(vote.res.status, 200);
    const duplicate = await request(base, `/api/participation/polls/${poll.body.id}/vote`, { method:'POST', headers:listenerHeaders, body:JSON.stringify({ optionId }) });
    assert.equal(duplicate.res.status, 409);

    const requested = await request(base, '/api/participation/requests', { method:'POST', headers:listenerHeaders, body:JSON.stringify({ mediaId:media.id, dedication:'For the night shift' }) });
    assert.equal(requested.res.status, 201);
    assert.equal(db.prepare('SELECT dedication FROM listener_requests').get().dedication, 'For the night shift');
  });
});
