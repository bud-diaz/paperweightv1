'use strict';

const { getDb } = require('../db');
const { identityForRequest, recordAudienceEvent } = require('../events');
const jobs = require('../jobs/runner');
const config = require('../config');

function activePolls() {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM polls WHERE status='open'
      AND (opens_at IS NULL OR opens_at <= datetime('now'))
      AND (closes_at IS NULL OR closes_at > datetime('now'))
    ORDER BY created_at DESC LIMIT 5
  `).all();
  return rows.map(poll => ({
    ...poll,
    options: db.prepare(`
      SELECT po.*, COUNT(pv.option_id) AS votes FROM poll_options po
      LEFT JOIN poll_votes pv ON pv.option_id=po.id
      WHERE po.poll_id=? GROUP BY po.id ORDER BY po.sort_order, po.id
    `).all(poll.id),
  }));
}

function submitRequest(req, mediaId, dedication) {
  const db = getDb();
  if (!req.tokenRow) return { error: 'Listener account required', status: 401 };
  const media = db.prepare("SELECT id FROM media WHERE id=? AND is_active=1 AND visibility='public' AND filepath NOT LIKE 'external://%'").get(mediaId);
  if (!media) return { error: 'Public track not found', status: 404 };
  const identity = identityForRequest(req, db);
  if (!identity.profileId && !identity.listenerId) return { error: 'Listener profile required', status: 401 };
  const recent = db.prepare(`
    SELECT COUNT(*) AS n FROM listener_requests
    WHERE (profile_id=? OR (? IS NOT NULL AND listener_id=?)) AND created_at >= datetime('now','-1 hour')
  `).get(identity.profileId, identity.listenerId, identity.listenerId).n;
  if (recent >= 3) return { error: 'Request limit reached; try again later', status: 429 };
  const cleanDedication = typeof dedication === 'string' ? dedication.trim().replace(/[\x00-\x1F\x7F]/g, '').slice(0, 240) : null;
  const info = db.prepare('INSERT INTO listener_requests (profile_id,listener_id,media_id,dedication) VALUES (?,?,?,?)')
    .run(identity.profileId, identity.listenerId, mediaId, cleanDedication || null);
  recordAudienceEvent('request_submitted', { req, db, mediaId, source: 'participation', dedupeKey: `request:${info.lastInsertRowid}` });
  return { value: { id: Number(info.lastInsertRowid), status: 'pending' } };
}

function vote(req, pollId, optionId) {
  const db = getDb();
  if (!req.tokenRow) return { error: 'Listener account required', status: 401 };
  const identity = identityForRequest(req, db);
  const identityKey = identity.profileId ? `profile:${identity.profileId}` : (identity.listenerId ? `listener:${identity.listenerId}` : null);
  if (!identityKey) return { error: 'Listener profile required', status: 401 };
  const option = db.prepare(`
    SELECT po.id FROM poll_options po JOIN polls p ON p.id=po.poll_id
    WHERE po.id=? AND po.poll_id=? AND p.status='open'
      AND (p.opens_at IS NULL OR p.opens_at <= datetime('now'))
      AND (p.closes_at IS NULL OR p.closes_at > datetime('now'))
  `).get(optionId, pollId);
  if (!option) return { error: 'Poll or option not available', status: 404 };
  try {
    db.prepare('INSERT INTO poll_votes (poll_id,option_id,profile_id,listener_id,identity_key) VALUES (?,?,?,?,?)')
      .run(pollId, optionId, identity.profileId, identity.listenerId, identityKey);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) return { error: 'You already voted in this poll', status: 409 };
    throw err;
  }
  recordAudienceEvent('poll_voted', { req, db, source: 'participation', dedupeKey: `poll:${pollId}:${identityKey}`, metadata: { poll_id: pollId, option_id: optionId } });
  return { value: { ok: true } };
}

function reminder(req, campaignId) {
  const db = getDb();
  if (!req.tokenRow) return { error: 'Listener account required', status: 401 };
  const release = db.prepare("SELECT id,title,release_at FROM release_campaigns WHERE id=? AND status='scheduled' AND release_at > datetime('now')").get(campaignId);
  if (!release) return { error: 'Upcoming release not found', status: 404 };
  const identity = identityForRequest(req, db);
  const profile = identity.profileId ? db.prepare('SELECT * FROM listener_profiles WHERE id=?').get(identity.profileId) : null;
  const account = identity.listenerId ? db.prepare('SELECT email FROM listener_accounts WHERE id=? AND is_active=1').get(identity.listenerId) : null;
  const email = String(profile?.email || account?.email || '').trim().toLowerCase();
  if (!email) return { error: 'Add an email to your account before requesting a reminder', status: 409 };
  const info = db.prepare(`
    INSERT OR IGNORE INTO premiere_reminders (campaign_id,profile_id,listener_id,email)
    VALUES (?,?,?,?)
  `).run(campaignId, identity.profileId, identity.listenerId, email);
  recordAudienceEvent('premiere_reminder_requested', { req, db, source: 'participation',
    dedupeKey: `reminder:${campaignId}:${email}`, metadata: { campaign_id: campaignId } });
  return { value: { ok: true, created: info.changes > 0, releaseAt: release.release_at } };
}

function queueReleaseReminders(campaign) {
  const db = getDb();
  const reminders = db.prepare('SELECT * FROM premiere_reminders WHERE campaign_id=? AND sent_at IS NULL').all(campaign.id);
  for (const reminder of reminders) {
    const key = `premiere-reminder:${reminder.id}`;
    const body = `${campaign.title} is available now on ${config.station.name || 'Paperweight'}.\n\nListen at ${config.station.publicUrl || `http://localhost:${config.port}`}`;
    const info = db.prepare(`
      INSERT OR IGNORE INTO delivery_outbox (channel,profile_id,listener_id,recipient_email,subject,body,payload,dedupe_key)
      VALUES ('email',?,?,?,?,?,?,?)
    `).run(reminder.profile_id, reminder.listener_id, reminder.email, `${campaign.title} is live`, body,
      JSON.stringify({ reminderId: reminder.id }), key);
    const deliveryId = info.changes ? Number(info.lastInsertRowid) : db.prepare('SELECT id FROM delivery_outbox WHERE dedupe_key=?').get(key)?.id;
    if (deliveryId) jobs.enqueue('delivery.send', { deliveryId }, { dedupeKey: `delivery:${deliveryId}`, maxAttempts: 4 });
  }
  return reminders.length;
}

function createPoll(input) {
  const question = typeof input.question === 'string' ? input.question.trim().slice(0, 240) : '';
  const options = [...new Set((Array.isArray(input.options) ? input.options : []).map(v => String(v).trim().slice(0,120)).filter(Boolean))];
  if (!question || options.length < 2 || options.length > 8) return { error: 'A question and 2–8 unique options are required' };
  const db = getDb();
  const id = db.transaction(() => {
    const info = db.prepare("INSERT INTO polls (question,status,opens_at,closes_at) VALUES (?,'draft',?,?)")
      .run(question, input.opensAt || null, input.closesAt || null);
    const pollId = Number(info.lastInsertRowid);
    const insert = db.prepare('INSERT INTO poll_options (poll_id,label,sort_order) VALUES (?,?,?)');
    options.forEach((label, index) => insert.run(pollId, label, index));
    return pollId;
  })();
  return { value: id };
}

module.exports = { activePolls, submitRequest, vote, reminder, queueReleaseReminders, createPoll };
