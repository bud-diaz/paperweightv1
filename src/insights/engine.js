'use strict';

const { getDb } = require('../db');
const { segmentPeople } = require('../audience');

function count(sql, params = []) {
  return Number(getDb().prepare(sql).get(...params)?.n || 0);
}

function returningListeners() {
  const current = count(`
    SELECT COUNT(*) AS n FROM (
      SELECT COALESCE(profile_id, listener_id) AS person
      FROM listen_events
      WHERE (profile_id IS NOT NULL OR listener_id IS NOT NULL)
        AND started_at >= datetime('now', '-7 days')
      GROUP BY person HAVING COUNT(DISTINCT date(started_at)) >= 2
    )
  `);
  const previous = count(`
    SELECT COUNT(*) AS n FROM (
      SELECT COALESCE(profile_id, listener_id) AS person
      FROM listen_events
      WHERE (profile_id IS NOT NULL OR listener_id IS NOT NULL)
        AND started_at >= datetime('now', '-14 days') AND started_at < datetime('now', '-7 days')
      GROUP BY person HAVING COUNT(DISTINCT date(started_at)) >= 2
    )
  `);
  if (!current) return null;
  return {
    key: 'returning-listeners', tone: current >= previous ? 'positive' : 'neutral',
    eyebrow: 'AUDIENCE MEMORY', title: `${current} regular listener${current === 1 ? '' : 's'} returned`,
    body: previous ? `${current - previous >= 0 ? '+' : ''}${current - previous} compared with the prior week.` : 'This is your first measurable returning-listener cohort.',
    action: { label: 'VIEW REGULARS', drawer: 'audience', segment: 'returning' },
    metric: current,
  };
}

function gateAbandonment() {
  const gates = count("SELECT COUNT(*) AS n FROM audience_events WHERE event_type = 'vault_gate_viewed' AND occurred_at >= datetime('now', '-7 days')");
  if (!gates) return null;
  const purchases = count("SELECT COUNT(*) AS n FROM audience_events WHERE event_type = 'unlock_completed' AND occurred_at >= datetime('now', '-7 days')");
  const missed = Math.max(0, gates - purchases);
  if (!missed) return null;
  return {
    key: 'vault-gate-dropoff', tone: 'opportunity', eyebrow: 'REVENUE SIGNAL',
    title: `${missed} vault visit${missed === 1 ? '' : 's'} stopped before purchase`,
    body: `${gates} gate views produced ${purchases} unlock${purchases === 1 ? '' : 's'} in the last seven days.`,
    action: { label: 'INSPECT SEGMENT', drawer: 'audience', segment: 'paywall_no_purchase' },
    metric: missed,
  };
}

function inactiveRegulars() {
  const people = segmentPeople('inactive_regulars', 100);
  if (!people.length) return null;
  return {
    key: 'inactive-regulars', tone: 'warning', eyebrow: 'RELATIONSHIP RISK',
    title: `${people.length} regular listener${people.length === 1 ? '' : 's'} went quiet`,
    body: 'They listened at least three times but have not returned in 30 days.',
    action: { label: 'REVIEW PEOPLE', drawer: 'audience', segment: 'inactive_regulars' },
    metric: people.length,
  };
}

function rotationFreshness() {
  const row = getDb().prepare(`
    SELECT COUNT(*) AS tracks, COALESCE(SUM(duration), 0) AS seconds
    FROM media WHERE is_active = 1 AND visibility = 'public' AND filepath NOT LIKE 'external://%'
  `).get();
  const hours = Number(row.seconds || 0) / 3600;
  if (hours >= 2 || Number(row.tracks) === 0) return null;
  return {
    key: 'rotation-freshness', tone: 'warning', eyebrow: 'STATION HEALTH',
    title: `Only ${hours.toFixed(1)} hours of public rotation`,
    body: 'A small rotation repeats quickly. Publish or upload more public material to keep the station fresh.',
    action: { label: 'OPEN LIBRARY', drawer: 'library' }, metric: Math.round(hours * 10) / 10,
  };
}

function releasePerformance() {
  const release = getDb().prepare(`
    SELECT * FROM release_campaigns WHERE status = 'published' ORDER BY published_at DESC LIMIT 1
  `).get();
  if (!release) return null;
  const itemIds = getDb().prepare('SELECT media_id FROM release_campaign_items WHERE campaign_id = ?').all(release.id).map(r => r.media_id);
  if (!itemIds.length) return null;
  const placeholders = itemIds.map(() => '?').join(',');
  const plays = count(`SELECT COUNT(*) AS n FROM audience_events WHERE event_type IN ('on_demand_started','on_demand_completed') AND media_id IN (${placeholders}) AND occurred_at >= ?`, [...itemIds, release.published_at]);
  const revenue = Number(getDb().prepare(`SELECT COALESCE(SUM(value_cents), 0) AS n FROM audience_events WHERE event_type = 'unlock_completed' AND media_id IN (${placeholders}) AND occurred_at >= ?`).get(...itemIds, release.published_at)?.n || 0);
  return {
    key: `release-${release.id}`, tone: 'positive', eyebrow: 'LATEST RELEASE',
    title: `${release.title}: ${plays} tracked play${plays === 1 ? '' : 's'}`,
    body: `${Math.round((Date.now() - new Date(String(release.published_at).replace(' ', 'T') + 'Z').getTime()) / 86400000)} days live · $${(revenue / 100).toFixed(2)} attributed unlock revenue.`,
    action: { label: 'VIEW RELEASE', drawer: 'releases', releaseId: release.id }, metric: revenue,
  };
}

function operations() {
  const errors = count("SELECT COUNT(*) AS n FROM system_log WHERE level = 'error' AND occurred_at >= datetime('now', '-24 hours')");
  const webhookErrors = count("SELECT COUNT(*) AS n FROM webhook_events WHERE outcome = 'error' AND received_at >= datetime('now', '-24 hours')");
  if (!errors && !webhookErrors) return null;
  return {
    key: 'ops-warning', tone: 'danger', eyebrow: 'NEEDS ATTENTION',
    title: `${errors + webhookErrors} operational error${errors + webhookErrors === 1 ? '' : 's'} in 24 hours`,
    body: `${errors} runtime · ${webhookErrors} payment webhook.`,
    action: { label: 'OPEN STATION OPS', drawer: 'ops' }, metric: errors + webhookErrors,
  };
}

const RULES = [returningListeners, gateAbandonment, inactiveRegulars, releasePerformance, rotationFreshness, operations];

function stateAllows(db, insight) {
  const state = db.prepare('SELECT * FROM insight_state WHERE insight_key = ?').get(insight.key);
  if (!state) {
    db.prepare('INSERT INTO insight_state (insight_key, metadata) VALUES (?, ?)').run(insight.key, JSON.stringify({ metric: insight.metric }));
    return true;
  }
  db.prepare("UPDATE insight_state SET last_seen_at = datetime('now'), metadata = ? WHERE insight_key = ?")
    .run(JSON.stringify({ metric: insight.metric }), insight.key);
  if (state.status === 'dismissed' || state.status === 'completed') return false;
  if (state.status === 'snoozed' && state.dismissed_until && new Date(state.dismissed_until).getTime() > Date.now()) return false;
  if (state.status === 'snoozed') {
    db.prepare("UPDATE insight_state SET status = 'active', dismissed_until = NULL WHERE insight_key = ?").run(insight.key);
  }
  return true;
}

function getToday() {
  const db = getDb();
  const insights = RULES.map(rule => rule()).filter(Boolean).filter(item => stateAllows(db, item));
  const outcomes = {
    returningListeners: returningListeners()?.metric || 0,
    optIns: count("SELECT COUNT(*) AS n FROM listener_profiles WHERE marketing_opt_in = 1 AND created_at >= datetime('now', '-7 days')"),
    payments: count("SELECT COUNT(*) AS n FROM audience_events WHERE event_type IN ('unlock_completed','tip_completed','subscription_started','subscription_renewed') AND occurred_at >= datetime('now', '-7 days')"),
    releases: count("SELECT COUNT(*) AS n FROM release_campaigns WHERE status = 'published' AND published_at >= datetime('now', '-7 days')"),
  };
  return { generatedAt: new Date().toISOString(), outcomes, insights };
}

module.exports = { getToday, RULES };
