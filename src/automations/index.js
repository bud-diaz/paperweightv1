'use strict';

const crypto = require('crypto');
const { getDb, log } = require('../db');
const { getBoolSetting } = require('../db/settings');
const { isEmailConfigured, sendMail } = require('../email');
const jobs = require('../jobs/runner');
const config = require('../config');

const TEMPLATES = {
  welcome_listener: {
    name: 'Welcome new listeners',
    description: 'Thank a newly opted-in listener and point them back to the station.',
    trigger: 'profile_created',
    marketing: true,
  },
  first_purchase_thanks: {
    name: 'Thank first-time buyers',
    description: 'Send a short transactional thank-you after a listener’s first unlock.',
    trigger: 'unlock_completed',
    marketing: false,
  },
  release_affinity: {
    name: 'Release affinity alert',
    description: 'Recommend a new release to opted-in listeners who already play similar work.',
    trigger: 'release_published',
    marketing: true,
  },
  inactive_regular: {
    name: 'Surface inactive regulars',
    description: 'Create creator follow-up recommendations for regulars who have gone quiet.',
    trigger: 'sweep',
    marketing: true,
  },
  post_live_followup: {
    name: 'Post-live follow-up',
    description: 'Thank opted-in listeners who were active around a live broadcast.',
    trigger: 'live_broadcast_ended',
    marketing: true,
  },
};

function stationUrl() {
  return config.station.publicUrl || `http://localhost:${config.port}`;
}

function emailHash(email) {
  return crypto.createHash('sha256').update(String(email).trim().toLowerCase()).digest('hex');
}

function unsubscribeToken(email) {
  const secret = config.auth.dashboardToken || 'paperweight-local';
  return crypto.createHmac('sha256', secret).update(`unsubscribe:${String(email).trim().toLowerCase()}`).digest('hex');
}

function unsubscribeUrl(email) {
  return `${stationUrl()}/api/automations/unsubscribe?email=${encodeURIComponent(email)}&token=${unsubscribeToken(email)}`;
}

function profileForEvent(db, event) {
  if (event.profile_id) {
    return db.prepare(`SELECT lp.*, la.email AS account_email FROM listener_profiles lp LEFT JOIN listener_accounts la ON la.id=lp.account_id WHERE lp.id=?`).get(event.profile_id);
  }
  if (event.listener_id) {
    return db.prepare(`SELECT lp.*, la.email AS account_email FROM listener_profiles lp LEFT JOIN listener_accounts la ON la.id=lp.account_id WHERE lp.account_id=? ORDER BY lp.created_at DESC LIMIT 1`).get(event.listener_id);
  }
  return null;
}

function recipientForProfile(profile) {
  return String(profile?.email || profile?.account_email || '').trim().toLowerCase() || null;
}

function isSuppressed(db, email) {
  return !!db.prepare('SELECT 1 FROM email_suppressions WHERE email_hash = ?').get(emailHash(email));
}

function buildMessage(templateKey, profile, context = {}) {
  const name = profile?.display_name || 'there';
  const station = config.station.name || 'Paperweight';
  if (templateKey === 'welcome_listener') return {
    subject: `Welcome to ${station}`,
    body: `Hi ${name},\n\nThanks for joining ${station}. The station, library, releases, and your collection are waiting at ${stationUrl()}.`,
  };
  if (templateKey === 'first_purchase_thanks') return {
    subject: `Thank you for supporting ${station}`,
    body: `Hi ${name},\n\nThank you for directly supporting ${station}. Your unlock is now available in Your Collection at ${stationUrl()}.`,
  };
  if (templateKey === 'release_affinity') return {
    subject: `${station}: ${context.releaseTitle || 'a new release'}`,
    body: `Hi ${name},\n\n${station} just published ${context.releaseTitle || 'a new release'}—and it connects with music you have listened to before. Hear it at ${stationUrl()}.`,
  };
  if (templateKey === 'post_live_followup') return {
    subject: `Thanks for listening live to ${station}`,
    body: `Hi ${name},\n\nThanks for spending time with ${station} live. Come back for the continuous station and latest releases at ${stationUrl()}.`,
  };
  return null;
}

function createRun(db, rule, event, profile, explanation, context = {}) {
  const identity = profile?.id || profile?.account_id || event?.listener_id || 'station';
  const occurrence = event?.id || new Date().toISOString().slice(0, 10);
  const dedupeKey = `${rule.template_key}:${identity}:${occurrence}`;
  const status = rule.mode === 'automatic' && rule.enabled ? 'queued' : 'recommended';
  const info = db.prepare(`
    INSERT OR IGNORE INTO automation_runs (rule_id, event_id, profile_id, listener_id, status, dedupe_key, explanation)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(rule.id, event?.id || null, profile?.id || null, profile?.account_id || event?.listener_id || null, status, dedupeKey, explanation);
  if (!info.changes) return null;
  const runId = Number(info.lastInsertRowid);
  if (status === 'queued') queueRun(runId, context);
  return runId;
}

function queueRun(runId, context = {}) {
  const db = getDb();
  const run = db.prepare(`
    SELECT ar.*, r.template_key, r.config, lp.display_name, lp.email, lp.account_id,
      la.email AS account_email, lp.marketing_opt_in
    FROM automation_runs ar JOIN automation_rules r ON r.id=ar.rule_id
    LEFT JOIN listener_profiles lp ON lp.id=ar.profile_id
    LEFT JOIN listener_accounts la ON la.id=COALESCE(ar.listener_id, lp.account_id)
    WHERE ar.id=?
  `).get(runId);
  if (!run) return { error: 'Automation run not found' };
  const template = TEMPLATES[run.template_key];
  const email = recipientForProfile(run);
  if (!template || !email) {
    db.prepare("UPDATE automation_runs SET status='skipped', last_error='No deliverable email' WHERE id=?").run(runId);
    return { error: 'No deliverable email' };
  }
  if (template.marketing && run.marketing_opt_in !== 1) {
    db.prepare("UPDATE automation_runs SET status='skipped', last_error='Marketing consent required' WHERE id=?").run(runId);
    return { error: 'Marketing consent required' };
  }
  if (isSuppressed(db, email)) {
    db.prepare("UPDATE automation_runs SET status='skipped', last_error='Recipient unsubscribed' WHERE id=?").run(runId);
    return { error: 'Recipient unsubscribed' };
  }
  const message = buildMessage(run.template_key, run, context);
  if (!message) return { error: 'No message template' };
  const body = template.marketing
    ? `${message.body}\n\nStop these emails: ${unsubscribeUrl(email)}`
    : message.body;
  const outboxKey = `automation-run:${runId}`;
  const info = db.prepare(`
    INSERT OR IGNORE INTO delivery_outbox (
      channel, profile_id, listener_id, recipient_email, subject, body, payload, dedupe_key
    ) VALUES ('email', ?, ?, ?, ?, ?, ?, ?)
  `).run(run.profile_id, run.listener_id, email, message.subject, body, JSON.stringify({ runId, marketing: template.marketing }), outboxKey);
  const deliveryId = info.changes
    ? Number(info.lastInsertRowid)
    : db.prepare('SELECT id FROM delivery_outbox WHERE dedupe_key=?').get(outboxKey)?.id;
  if (deliveryId) jobs.enqueue('delivery.send', { deliveryId }, { dedupeKey: `delivery:${deliveryId}`, maxAttempts: 4 });
  db.prepare("UPDATE automation_runs SET status='queued', last_error=NULL WHERE id=?").run(runId);
  return { ok: true, deliveryId };
}

function evaluateEvent(eventId) {
  const db = getDb();
  if (getBoolSetting('automations_paused', false)) return;
  const event = db.prepare('SELECT * FROM audience_events WHERE id=?').get(eventId);
  if (!event) return;
  const profile = profileForEvent(db, event);
  const rules = db.prepare('SELECT * FROM automation_rules WHERE enabled=1 OR mode=\'draft\'').all();
  for (const rule of rules) {
    const template = TEMPLATES[rule.template_key];
    if (!template || template.trigger !== event.event_type) continue;
    if (rule.template_key === 'welcome_listener' && !profile) continue;
    if (rule.template_key === 'first_purchase_thanks') {
      const prior = db.prepare(`SELECT COUNT(*) AS n FROM audience_events WHERE event_type='unlock_completed' AND listener_id=? AND id < ?`).get(event.listener_id, event.id)?.n || 0;
      if (prior > 0) continue;
    }
    if (rule.template_key === 'release_affinity') {
      const media = db.prepare('SELECT genre, COALESCE(title,filename) AS title FROM media WHERE id=?').get(event.media_id);
      if (!media) continue;
      const profiles = db.prepare(`
        SELECT DISTINCT lp.*, la.email AS account_email FROM listener_profiles lp
        LEFT JOIN listener_accounts la ON la.id=lp.account_id
        JOIN listen_events le ON le.profile_id=lp.id OR (lp.account_id IS NOT NULL AND le.listener_id=lp.account_id)
        JOIN media m ON m.id=le.media_id
        WHERE lp.marketing_opt_in=1 AND (? IS NULL OR lower(m.genre)=lower(?))
        LIMIT 250
      `).all(media.genre, media.genre);
      for (const target of profiles) createRun(db, rule, event, target, `Listened to ${media.genre || 'related work'} before this release.`, { releaseTitle: media.title });
      continue;
    }
    if (rule.template_key === 'post_live_followup') {
      const profiles = db.prepare(`
        SELECT DISTINCT lp.*, la.email AS account_email FROM listener_profiles lp
        LEFT JOIN listener_accounts la ON la.id=lp.account_id
        JOIN listen_events le ON le.profile_id=lp.id OR (lp.account_id IS NOT NULL AND le.listener_id=lp.account_id)
        WHERE lp.marketing_opt_in=1 AND le.started_at >= datetime('now','-2 hours') LIMIT 250
      `).all();
      for (const target of profiles) createRun(db, rule, event, target, 'Listened around the live broadcast.');
      continue;
    }
    createRun(db, rule, event, profile, template.description);
  }
}

function sweepInactive() {
  const db = getDb();
  const rule = db.prepare("SELECT * FROM automation_rules WHERE template_key='inactive_regular'").get();
  if (!rule) return 0;
  const people = require('../audience').segmentPeople('inactive_regulars', 250);
  let created = 0;
  for (const person of people) {
    const id = createRun(db, rule, null, { id: person.profile_id, account_id: person.listener_id }, 'A previous regular has not listened in 30 days.');
    if (id) created++;
  }
  return created;
}

async function sendDelivery(deliveryId) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM delivery_outbox WHERE id=?').get(deliveryId);
  if (!row || ['sent', 'cancelled', 'suppressed'].includes(row.status)) return;
  if (getBoolSetting('automations_paused', false)) throw new Error('Automations are paused');
  if (row.channel !== 'email') throw new Error('Unsupported delivery channel');
  if (!isEmailConfigured()) throw new Error('SMTP is not configured');
  if (isSuppressed(db, row.recipient_email)) {
    db.prepare("UPDATE delivery_outbox SET status='suppressed', last_error='Recipient unsubscribed' WHERE id=?").run(deliveryId);
    return;
  }
  db.prepare("UPDATE delivery_outbox SET status='sending', attempts=attempts+1 WHERE id=?").run(deliveryId);
  try {
    await sendMail({ to: row.recipient_email, subject: row.subject || config.station.name, text: row.body });
    db.transaction(() => {
      db.prepare("UPDATE delivery_outbox SET status='sent', sent_at=datetime('now'), last_error=NULL WHERE id=?").run(deliveryId);
      const payload = (() => { try { return JSON.parse(row.payload || '{}'); } catch { return {}; } })();
      if (payload.runId) db.prepare("UPDATE automation_runs SET status='sent', executed_at=datetime('now'), last_error=NULL WHERE id=?").run(payload.runId);
      if (payload.reminderId) db.prepare("UPDATE premiere_reminders SET sent_at=datetime('now') WHERE id=?").run(payload.reminderId);
    })();
  } catch (err) {
    db.prepare("UPDATE delivery_outbox SET status='failed', last_error=? WHERE id=?").run(String(err.message).slice(0,1000), deliveryId);
    throw err;
  }
}

function listRules() {
  return getDb().prepare('SELECT * FROM automation_rules ORDER BY id').all().map(rule => ({ ...rule, ...TEMPLATES[rule.template_key] }));
}

function updateRule(id, input) {
  const mode = input.mode;
  if (mode !== undefined && !['draft', 'automatic'].includes(mode)) return false;
  const rule = getDb().prepare('SELECT * FROM automation_rules WHERE id=?').get(id);
  if (!rule) return false;
  getDb().prepare(`UPDATE automation_rules SET enabled=?, mode=?, config=?, updated_at=datetime('now') WHERE id=?`).run(
    input.enabled === undefined ? rule.enabled : (input.enabled ? 1 : 0),
    mode || rule.mode,
    input.config === undefined ? rule.config : JSON.stringify(input.config || {}),
    id
  );
  return true;
}

function unsubscribe(email, token) {
  const normalized = String(email || '').trim().toLowerCase();
  const expected = unsubscribeToken(normalized);
  const a = Buffer.from(expected); const b = Buffer.from(String(token || ''));
  if (!normalized || a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  const db = getDb();
  db.prepare('INSERT OR IGNORE INTO email_suppressions (email_hash, reason) VALUES (?, ?)').run(emailHash(normalized), 'listener_unsubscribe');
  db.prepare('UPDATE listener_profiles SET marketing_opt_in=0 WHERE lower(email)=?').run(normalized);
  db.prepare("UPDATE delivery_outbox SET status='suppressed' WHERE lower(recipient_email)=? AND status IN ('pending','failed')").run(normalized);
  return true;
}

jobs.register('automation.evaluate', payload => evaluateEvent(Number(payload.eventId)));
jobs.register('delivery.send', payload => sendDelivery(Number(payload.deliveryId)));

module.exports = { TEMPLATES, listRules, updateRule, evaluateEvent, sweepInactive, queueRun, sendDelivery, unsubscribe, unsubscribeToken };
