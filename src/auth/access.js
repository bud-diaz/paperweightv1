const { canAccessVaultContent } = require('./vault');
const { getDb } = require('../db');

const TIER_RANK = {
  free: 0,
  subscriber: 1,
  pro: 2,
  all_access: 3,
};

const SUBSCRIBER_TIERS = new Set(['subscriber', 'pro', 'all_access']);

function isSubscriberTier(tier) {
  return SUBSCRIBER_TIERS.has(tier);
}

function isHigherTier(candidate, current) {
  return (TIER_RANK[candidate] ?? 0) > (TIER_RANK[current] ?? 0);
}

function hasScopedVaultAccess(req, mediaId, projectId) {
  const tok = req.tokenRow;
  if (!tok || !tok.scope_type) return false;
  if (tok.scope_type === 'track' && Number(tok.scope_id) === Number(mediaId)) return true;
  if (tok.scope_type === 'project' && Number(tok.scope_id) === Number(projectId)) return true;
  return false;
}

function allAccessTierIncludesVault() {
  try {
    const row = getDb().prepare(
      'SELECT subscribers_included FROM vault_all_access WHERE id = 1'
    ).get();
    return row?.subscribers_included === 1;
  } catch {
    return false;
  }
}

function canAccessMedia(req, media, projectId = null) {
  if (!media) return { allowed: false, error: 'Not found' };

  if (media.visibility === 'supporters_only') {
    if (!isSubscriberTier(req.tier) && !hasScopedVaultAccess(req, media.id, projectId)) {
      return { allowed: false, error: 'Supporter access required' };
    }
  }

  if (media.visibility === 'vault') {
    if (isSubscriberTier(req.tier) && allAccessTierIncludesVault()) {
      return { allowed: true };
    }

    if (!hasScopedVaultAccess(req, media.id, projectId)) {
      const listenerId = req.tokenRow?.listener_id || null;
      const result = canAccessVaultContent(listenerId, media.id);
      if (!result.allowed) {
        return {
          allowed: false,
          error: 'Vault access required',
          unlockOptions: result.unlockOptions,
        };
      }
    }
  }

  return { allowed: true };
}

function canDownloadMedia(req, media, projectId = null) {
  if (media.visibility === 'vault') {
    return canAccessMedia(req, media, projectId);
  }

  if (!isSubscriberTier(req.tier)) {
    return { allowed: false, error: 'Subscriber access required' };
  }

  return { allowed: true };
}

module.exports = {
  SUBSCRIBER_TIERS,
  isSubscriberTier,
  isHigherTier,
  hasScopedVaultAccess,
  canAccessMedia,
  canDownloadMedia,
};
