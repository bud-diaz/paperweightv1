'use strict';

const { getDb } = require('../db');

const SEGMENTS = {
  new: 'New listeners',
  returning: 'Returning regulars',
  buyers: 'Buyers',
  subscribers: 'Active subscribers',
  top_supporters: 'Top supporters',
  inactive_regulars: 'Inactive regulars',
  paywall_no_purchase: 'Reached a gate, did not buy',
};

function audienceRows({ search = '', limit = 50, offset = 0 } = {}) {
  const db = getDb();
  const cleanSearch = String(search || '').trim().slice(0, 100);
  return db.prepare(`
    SELECT
      lp.id AS profile_id,
      lp.account_id AS listener_id,
      COALESCE(NULLIF(lp.display_name, ''), la.email, 'Listener') AS display_name,
      lp.email,
      lp.marketing_opt_in,
      lp.created_at,
      lp.last_seen_at,
      la.is_active,
      (SELECT MAX(le.started_at) FROM listen_events le
        WHERE le.profile_id = lp.id OR (lp.account_id IS NOT NULL AND le.listener_id = lp.account_id)) AS last_listen_at,
      (SELECT COUNT(*) FROM listen_events le
        WHERE le.profile_id = lp.id OR (lp.account_id IS NOT NULL AND le.listener_id = lp.account_id)) AS listen_count,
      (SELECT COALESCE(SUM(le.seconds), 0) FROM listen_events le
        WHERE le.profile_id = lp.id OR (lp.account_id IS NOT NULL AND le.listener_id = lp.account_id)) AS listen_seconds,
      (SELECT COUNT(*) FROM vault_unlocks vu WHERE vu.listener_id = lp.account_id) AS purchase_count,
      (SELECT COALESCE(SUM(vu.amount_paid), 0) FROM vault_unlocks vu WHERE vu.listener_id = lp.account_id) AS purchase_cents,
      (SELECT COUNT(*) FROM subscriptions s WHERE s.listener_id = lp.account_id
        AND s.status = 'active' AND datetime(s.current_period_end) > datetime('now')) AS active_subscriptions,
      (SELECT COUNT(DISTINCT date(le.started_at)) FROM listen_events le
        WHERE (le.profile_id = lp.id OR (lp.account_id IS NOT NULL AND le.listener_id = lp.account_id))
          AND le.started_at >= datetime('now', '-30 days')) AS active_days_30,
      (SELECT m.title FROM listen_events le JOIN media m ON m.id = le.media_id
        WHERE le.profile_id = lp.id OR (lp.account_id IS NOT NULL AND le.listener_id = lp.account_id)
        GROUP BY le.media_id ORDER BY SUM(le.seconds) DESC LIMIT 1) AS favorite_title
    FROM listener_profiles lp
    LEFT JOIN listener_accounts la ON la.id = lp.account_id
    WHERE (:search = '' OR lower(COALESCE(lp.display_name, '')) LIKE :pattern OR lower(COALESCE(lp.email, la.email, '')) LIKE :pattern)
    ORDER BY COALESCE(last_listen_at, lp.last_seen_at, lp.created_at) DESC
    LIMIT :limit OFFSET :offset
  `).all({ search: cleanSearch.toLowerCase(), pattern: `%${cleanSearch.toLowerCase()}%`, limit, offset });
}

function segmentMatches(row, key) {
  const last = new Date(row.last_listen_at || row.last_seen_at || 0).getTime();
  const created = new Date(row.created_at || 0).getTime();
  const now = Date.now();
  switch (key) {
    case 'new': return now - created <= 7 * 86400000;
    case 'returning': return Number(row.active_days_30) >= 2;
    case 'buyers': return Number(row.purchase_count) > 0;
    case 'subscribers': return Number(row.active_subscriptions) > 0;
    case 'top_supporters': return Number(row.purchase_cents) > 0 || Number(row.active_subscriptions) > 0;
    case 'inactive_regulars': return Number(row.listen_count) >= 3 && last > 0 && now - last >= 30 * 86400000;
    default: return false;
  }
}

function segmentPeople(key, limit = 100) {
  if (!SEGMENTS[key]) return null;
  if (key === 'paywall_no_purchase') {
    return getDb().prepare(`
      SELECT DISTINCT lp.id AS profile_id, lp.account_id AS listener_id,
        COALESCE(lp.display_name, la.email, 'Listener') AS display_name,
        lp.email, lp.marketing_opt_in,
        MAX(ae.occurred_at) AS last_gate_at
      FROM audience_events ae
      JOIN listener_profiles lp ON lp.id = ae.profile_id OR (ae.profile_id IS NULL AND lp.account_id = ae.listener_id)
      LEFT JOIN listener_accounts la ON la.id = lp.account_id
      WHERE ae.event_type = 'vault_gate_viewed'
        AND ae.occurred_at >= datetime('now', '-30 days')
        AND NOT EXISTS (
          SELECT 1 FROM audience_events bought
          WHERE bought.event_type = 'unlock_completed'
            AND ((bought.profile_id = lp.id) OR (lp.account_id IS NOT NULL AND bought.listener_id = lp.account_id))
            AND bought.occurred_at >= ae.occurred_at
        )
      GROUP BY lp.id
      ORDER BY last_gate_at DESC
      LIMIT ?
    `).all(limit);
  }

  const rows = audienceRows({ limit: 1000, offset: 0 }).filter(row => segmentMatches(row, key));
  if (key === 'top_supporters') rows.sort((a, b) => Number(b.purchase_cents) - Number(a.purchase_cents));
  return rows.slice(0, limit);
}

function segmentSummary() {
  return Object.entries(SEGMENTS).map(([key, label]) => ({
    key,
    label,
    count: segmentPeople(key, 10000).length,
  }));
}

function person(profileId) {
  const profile = getDb().prepare(`
    SELECT lp.*, la.email AS account_email, la.created_at AS account_created_at,
      la.email_verified_at
    FROM listener_profiles lp
    LEFT JOIN listener_accounts la ON la.id = lp.account_id
    WHERE lp.id = ?
  `).get(profileId);
  if (!profile) return null;

  const summary = audienceRows({ limit: 1000 }).find(row => row.profile_id === Number(profileId)) || profile;
  const eventRows = getDb().prepare(`
    SELECT ae.id, ae.event_type AS type, ae.media_id, ae.project_id, ae.post_id,
      ae.source, ae.value_cents, ae.currency, ae.metadata, ae.occurred_at,
      m.title AS media_title
    FROM audience_events ae
    LEFT JOIN media m ON m.id = ae.media_id
    WHERE ae.profile_id = ? OR (? IS NOT NULL AND ae.listener_id = ?)
    ORDER BY ae.occurred_at DESC LIMIT 100
  `).all(profile.id, profile.account_id, profile.account_id);
  const listenRows = getDb().prepare(`
    SELECT le.id, 'listen' AS type, le.media_id, le.source, le.seconds,
      le.started_at AS occurred_at, m.title AS media_title
    FROM listen_events le
    LEFT JOIN media m ON m.id = le.media_id
    WHERE le.profile_id = ? OR (? IS NOT NULL AND le.listener_id = ?)
    ORDER BY le.started_at DESC LIMIT 100
  `).all(profile.id, profile.account_id, profile.account_id);
  const timeline = [...eventRows, ...listenRows]
    .sort((a, b) => String(b.occurred_at).localeCompare(String(a.occurred_at)))
    .slice(0, 100);

  return { ...summary, timeline };
}

module.exports = { SEGMENTS, audienceRows, segmentPeople, segmentSummary, person };
