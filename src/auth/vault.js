const { getDb } = require('../db');

const SUBSCRIBER_TIERS = new Set(['subscriber', 'pro', 'all_access']);

// Returns true if the unlock record is currently active.
// one_time unlocks are permanent (active=1 is sufficient).
// recurring unlocks additionally require a non-expired expires_at.
function isUnlockActive(row) {
  if (!row || !row.active) return false;
  if (row.payment_type === 'recurring') {
    if (row.expires_at && new Date(row.expires_at) <= new Date()) return false;
  }
  return true;
}

// Checks whether a listener can access a vault content item.
// Only call this when media.visibility = 'vault'.
//
// Returns:
//   { allowed: true }
//   { allowed: false, unlockOptions: { track, project, allAccess } }
//
// Access chain:
//   1. subscriber tier + creator has subscribers_included=1 → allow
//   2. Active all_access vault unlock → allow
//   3. Active project unlock for the content's project → allow
//   4. Active per-track unlock → allow
//   5. Deny with pricing options
function canAccessVaultContent(listenerId, contentId) {
  const db = getDb();

  // ── Step 1: subscriber bypass (if creator enabled it) ────────────────────
  if (listenerId) {
    const vaultConfig = db.prepare(
      'SELECT subscribers_included FROM vault_all_access WHERE id = 1'
    ).get();

    if (vaultConfig && vaultConfig.subscribers_included === 1) {
      const tokenRow = db.prepare(
        `SELECT tier
         FROM tokens
         WHERE listener_id = ? AND is_active = 1
           AND tier IN ('subscriber', 'pro', 'all_access')
         ORDER BY
           CASE tier
             WHEN 'all_access' THEN 3
             WHEN 'pro' THEN 2
             WHEN 'subscriber' THEN 1
             ELSE 0
           END DESC
         LIMIT 1`
      ).get(listenerId);

      if (tokenRow && SUBSCRIBER_TIERS.has(tokenRow.tier)) {
        // Verify subscription is still active
        const sub = db.prepare(
          "SELECT current_period_end FROM subscriptions WHERE listener_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1"
        ).get(listenerId);
        if (sub && new Date(sub.current_period_end) > new Date()) {
          return { allowed: true };
        }
      }
    }
  }

  // ── Step 2: all_access vault unlock ────────────────────────────────────────
  if (listenerId) {
    const allAccessUnlock = db.prepare(
      "SELECT * FROM vault_unlocks WHERE listener_id = ? AND unlock_type = 'all_access' AND active = 1 ORDER BY created_at DESC LIMIT 1"
    ).get(listenerId);
    if (isUnlockActive(allAccessUnlock)) return { allowed: true };
  }

  // ── Step 3: project unlock ─────────────────────────────────────────────────
  const projectMembership = db.prepare(
    'SELECT project_id FROM vault_project_items WHERE content_id = ?'
  ).get(contentId);

  if (listenerId && projectMembership) {
    const projectUnlock = db.prepare(
      "SELECT * FROM vault_unlocks WHERE listener_id = ? AND unlock_type = 'project' AND target_id = ? AND active = 1 ORDER BY created_at DESC LIMIT 1"
    ).get(listenerId, projectMembership.project_id);
    if (isUnlockActive(projectUnlock)) return { allowed: true };
  }

  // ── Step 4: per-track unlock ───────────────────────────────────────────────
  if (listenerId) {
    const trackUnlock = db.prepare(
      "SELECT * FROM vault_unlocks WHERE listener_id = ? AND unlock_type = 'track' AND target_id = ? AND active = 1 ORDER BY created_at DESC LIMIT 1"
    ).get(listenerId, contentId);
    if (isUnlockActive(trackUnlock)) return { allowed: true };
  }

  // ── Step 5: Denied — build unlock options payload ─────────────────────────
  const trackPrice = db.prepare(
    'SELECT * FROM vault_prices WHERE content_id = ?'
  ).get(contentId) || null;

  let project = null;
  if (projectMembership) {
    project = db.prepare(
      'SELECT * FROM vault_projects WHERE id = ?'
    ).get(projectMembership.project_id) || null;
  }

  const allAccess = db.prepare(
    'SELECT * FROM vault_all_access WHERE id = 1 AND enabled = 1'
  ).get() || null;

  return {
    allowed: false,
    unlockOptions: {
      track:     trackPrice,
      project:   project,
      allAccess: allAccess,
    },
  };
}

module.exports = { canAccessVaultContent };
