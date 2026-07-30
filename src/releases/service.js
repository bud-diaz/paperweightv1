'use strict';

const { getDb, log } = require('../db');
const { toSqliteDatetime } = require('../runtime/datetime');
const jobs = require('../jobs/runner');
const notify = require('../notify');
const broadcast = require('../broadcast');
const { recordAudienceEvent } = require('../events');

const VISIBILITIES = new Set(['public', 'supporters_only', 'vault']);
const POST_VISIBILITIES = new Set(['public', 'supporters_only']);

function cleanText(value, max) {
  const result = typeof value === 'string' ? value.trim().slice(0, max) : '';
  return result || null;
}

function validate(input, existing = null) {
  const title = input.title !== undefined ? cleanText(input.title, 160) : existing?.title;
  if (!title) return { error: 'Release title is required' };
  const releaseAt = input.releaseAt !== undefined ? toSqliteDatetime(input.releaseAt) : existing?.release_at;
  if (!releaseAt) return { error: 'A valid release time is required' };
  const visibility = input.visibility || existing?.visibility || 'public';
  if (!VISIBILITIES.has(visibility)) return { error: 'Invalid release visibility' };
  const postVisibility = input.postVisibility || existing?.post_visibility || 'public';
  if (!POST_VISIBILITIES.has(postVisibility)) return { error: 'Invalid post visibility' };
  const itemIds = input.itemIds !== undefined
    ? [...new Set((Array.isArray(input.itemIds) ? input.itemIds : []).map(Number).filter(Number.isSafeInteger))]
    : null;
  if (!existing && (!itemIds || !itemIds.length)) return { error: 'Select at least one track' };
  return { value: {
    title,
    description: input.description !== undefined ? cleanText(input.description, 2000) : existing?.description,
    projectId: input.projectId !== undefined ? (Number(input.projectId) || null) : existing?.project_id,
    releaseAt,
    visibility,
    postTitle: input.postTitle !== undefined ? cleanText(input.postTitle, 160) : existing?.post_title,
    postBody: input.postBody !== undefined ? cleanText(input.postBody, 20000) : existing?.post_body,
    postVisibility,
    notifyWebhook: input.notifyWebhook !== undefined ? !!input.notifyWebhook : (existing ? !!existing.notify_webhook : true),
    notifySupporters: input.notifySupporters !== undefined ? !!input.notifySupporters : !!existing?.notify_supporters,
    setHighlight: input.setHighlight !== undefined ? !!input.setHighlight : (existing ? !!existing.set_highlight : true),
    queuePremiere: input.queuePremiere !== undefined ? !!input.queuePremiere : !!existing?.queue_premiere,
    itemIds,
  } };
}

function verifyItems(db, itemIds) {
  if (!itemIds?.length) return [];
  const placeholders = itemIds.map(() => '?').join(',');
  const rows = db.prepare(`SELECT id, title, filename, filepath, visibility, is_active FROM media WHERE id IN (${placeholders}) AND is_active = 1`).all(...itemIds);
  if (rows.length !== itemIds.length) throw new Error('One or more release tracks are missing or inactive');
  return itemIds.map(id => rows.find(row => row.id === id));
}

function ensurePublishJob(campaignId, releaseAt) {
  const key = `release:${campaignId}:publish`;
  if (!jobs.reschedule(key, releaseAt, { campaignId })) {
    jobs.enqueue('release.publish', { campaignId }, { runAt: releaseAt, dedupeKey: key, maxAttempts: 8 });
  }
}

function get(id) {
  const db = getDb();
  const campaign = db.prepare('SELECT * FROM release_campaigns WHERE id = ?').get(id);
  if (!campaign) return null;
  campaign.items = db.prepare(`
    SELECT m.id, COALESCE(m.title, m.filename) AS title, m.artist, m.visibility, rci.sort_order
    FROM release_campaign_items rci JOIN media m ON m.id = rci.media_id
    WHERE rci.campaign_id = ? ORDER BY rci.sort_order
  `).all(id);
  return campaign;
}

function list() {
  return getDb().prepare(`
    SELECT rc.*, COUNT(rci.media_id) AS item_count
    FROM release_campaigns rc LEFT JOIN release_campaign_items rci ON rci.campaign_id = rc.id
    GROUP BY rc.id ORDER BY rc.release_at DESC
  `).all();
}

function create(input) {
  const validated = validate(input || {});
  if (validated.error) return validated;
  const value = validated.value;
  const db = getDb();
  try {
    const id = db.transaction(() => {
      verifyItems(db, value.itemIds);
      const info = db.prepare(`
        INSERT INTO release_campaigns (
          title, description, project_id, release_at, visibility, post_title,
          post_body, post_visibility, notify_webhook, notify_supporters,
          set_highlight, queue_premiere, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled')
      `).run(value.title, value.description, value.projectId, value.releaseAt, value.visibility,
        value.postTitle, value.postBody, value.postVisibility, value.notifyWebhook ? 1 : 0,
        value.notifySupporters ? 1 : 0, value.setHighlight ? 1 : 0, value.queuePremiere ? 1 : 0);
      const campaignId = Number(info.lastInsertRowid);
      const insert = db.prepare('INSERT INTO release_campaign_items (campaign_id, media_id, sort_order) VALUES (?, ?, ?)');
      value.itemIds.forEach((mediaId, index) => insert.run(campaignId, mediaId, index));
      return campaignId;
    })();
    ensurePublishJob(id, value.releaseAt);
    return { value: get(id) };
  } catch (err) { return { error: err.message }; }
}

function update(id, input) {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM release_campaigns WHERE id = ?').get(id);
  if (!existing) return { error: 'Release not found', status: 404 };
  if (['publishing', 'published'].includes(existing.status)) return { error: 'Published releases cannot be edited', status: 409 };
  const validated = validate(input || {}, existing);
  if (validated.error) return validated;
  const value = validated.value;
  try {
    db.transaction(() => {
      const itemIds = value.itemIds || db.prepare('SELECT media_id FROM release_campaign_items WHERE campaign_id = ? ORDER BY sort_order').all(id).map(r => r.media_id);
      verifyItems(db, itemIds);
      db.prepare(`
        UPDATE release_campaigns SET title=?, description=?, project_id=?, release_at=?, visibility=?,
          post_title=?, post_body=?, post_visibility=?, notify_webhook=?, notify_supporters=?,
          set_highlight=?, queue_premiere=?, status='scheduled', last_error=NULL, updated_at=datetime('now')
        WHERE id=?
      `).run(value.title, value.description, value.projectId, value.releaseAt, value.visibility,
        value.postTitle, value.postBody, value.postVisibility, value.notifyWebhook ? 1 : 0,
        value.notifySupporters ? 1 : 0, value.setHighlight ? 1 : 0, value.queuePremiere ? 1 : 0, id);
      if (value.itemIds) {
        db.prepare('DELETE FROM release_campaign_items WHERE campaign_id = ?').run(id);
        const insert = db.prepare('INSERT INTO release_campaign_items (campaign_id, media_id, sort_order) VALUES (?, ?, ?)');
        value.itemIds.forEach((mediaId, index) => insert.run(id, mediaId, index));
      }
    })();
    ensurePublishJob(id, value.releaseAt);
    return { value: get(id) };
  } catch (err) { return { error: err.message }; }
}

async function publish(campaignId) {
  const db = getDb();
  let result;
  try {
    result = db.transaction(() => {
      const campaign = db.prepare('SELECT * FROM release_campaigns WHERE id = ?').get(campaignId);
      if (!campaign) throw new Error('Release not found');
      if (campaign.status === 'published') return { campaign, items: [], alreadyPublished: true };
      if (campaign.status === 'cancelled') return { campaign, items: [], cancelled: true };
      db.prepare("UPDATE release_campaigns SET status='publishing', updated_at=datetime('now') WHERE id=?").run(campaignId);
      const items = db.prepare(`SELECT m.* FROM release_campaign_items rci JOIN media m ON m.id = rci.media_id WHERE rci.campaign_id = ? ORDER BY rci.sort_order`).all(campaignId);
      if (!items.length) throw new Error('Release has no tracks');
      const updateMedia = db.prepare("UPDATE media SET visibility=?, release_at=NULL, updated_at=datetime('now') WHERE id=? AND is_active=1");
      for (const item of items) updateMedia.run(campaign.visibility, item.id);
      let post = null;
      if (campaign.post_body) {
        const info = db.prepare(`
          INSERT INTO creator_posts (title, body, visibility, published_at, notify_supporters, release_notified_at)
          VALUES (?, ?, ?, datetime('now'), ?, datetime('now'))
        `).run(campaign.post_title || campaign.title, campaign.post_body, campaign.post_visibility, campaign.notify_supporters);
        post = db.prepare('SELECT * FROM creator_posts WHERE id = ?').get(info.lastInsertRowid);
      }
      if (campaign.set_highlight) {
        const type = campaign.project_id ? 'project' : 'track';
        const highlightId = campaign.project_id || items[0].id;
        db.prepare(`
          INSERT INTO highlight_config (id, highlight_type, highlight_id, updated_at)
          VALUES (1, ?, ?, datetime('now'))
          ON CONFLICT(id) DO UPDATE SET highlight_type=excluded.highlight_type,
            highlight_id=excluded.highlight_id, updated_at=excluded.updated_at
        `).run(type, highlightId);
      }
      db.prepare("UPDATE release_campaigns SET status='published', published_at=datetime('now'), last_error=NULL, updated_at=datetime('now') WHERE id=?").run(campaignId);
      return { campaign: db.prepare('SELECT * FROM release_campaigns WHERE id = ?').get(campaignId), items, post };
    })();
  } catch (err) {
    db.prepare("UPDATE release_campaigns SET status='failed', last_error=?, updated_at=datetime('now') WHERE id=?")
      .run(String(err.message).slice(0, 1000), campaignId);
    throw err;
  }
  if (result.alreadyPublished || result.cancelled) return result;
  if (result.campaign.notify_webhook) notify.releasePublished(result.campaign);
  if (result.post) notify.postPublished(result.post, { emailSupporters: !!result.campaign.notify_supporters, webhook: false });
  if (result.campaign.queue_premiere && result.campaign.visibility === 'public') broadcast.addToStationQueue(result.items[0].id);
  try { require('../participation').queueReleaseReminders(result.campaign); } catch (err) {
    log('warn', 'release', `Could not queue premiere reminders: ${err.message}`);
  }
  for (const item of result.items) {
    recordAudienceEvent('release_published', { db, mediaId: item.id, projectId: result.campaign.project_id,
      source: 'release', dedupeKey: `release:${campaignId}:media:${item.id}`,
      metadata: { campaign_id: campaignId, title: result.campaign.title } });
  }
  log('info', 'release', `Release campaign ${campaignId} published (${result.items.length} tracks)`);
  return result;
}

function cancel(id) {
  const info = getDb().prepare("UPDATE release_campaigns SET status='cancelled', updated_at=datetime('now') WHERE id=? AND status IN ('draft','scheduled','failed')").run(id);
  if (info.changes) jobs.cancel(`release:${id}:publish`);
  return info.changes > 0;
}

function report(id) {
  const campaign = get(id);
  if (!campaign) return null;
  const ids = campaign.items.map(item => item.id);
  if (!ids.length) return { campaign, plays: 0, completions: 0, gateViews: 0, unlocks: 0, revenueCents: 0 };
  const placeholders = ids.map(() => '?').join(',');
  const since = campaign.published_at || campaign.release_at;
  const row = getDb().prepare(`
    SELECT SUM(CASE WHEN event_type='on_demand_started' THEN 1 ELSE 0 END) AS plays,
      SUM(CASE WHEN event_type='on_demand_completed' THEN 1 ELSE 0 END) AS completions,
      SUM(CASE WHEN event_type='vault_gate_viewed' THEN 1 ELSE 0 END) AS gate_views,
      SUM(CASE WHEN event_type='unlock_completed' THEN 1 ELSE 0 END) AS unlocks,
      COALESCE(SUM(CASE WHEN event_type='unlock_completed' THEN value_cents ELSE 0 END), 0) AS revenue_cents
    FROM audience_events WHERE media_id IN (${placeholders}) AND occurred_at >= ?
  `).get(...ids, since);
  return { campaign, plays: row.plays || 0, completions: row.completions || 0,
    gateViews: row.gate_views || 0, unlocks: row.unlocks || 0, revenueCents: row.revenue_cents || 0 };
}

jobs.register('release.publish', payload => publish(Number(payload.campaignId)));

module.exports = { create, update, get, list, publish, cancel, report, validate };
