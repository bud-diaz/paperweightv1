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

const EMAIL_VERIFICATION_GRACE_MS = 24 * 60 * 60 * 1000;

// Gates tier-based paid content (supporters_only + the vault subscriber
// bypass) on email verification, with a 24h grace period from the moment the
// account first went paid (see activateSubscription in src/api/payment.js,
// which sets req.tokenRow-adjacent emailVerification via attachTier).
// req.emailVerification is only populated for subscriber+ tiers; free-tier
// requests always pass (nothing to gate).
function isEmailVerificationOk(req) {
  const info = req.emailVerification;
  if (!info) return true;
  if (info.verifiedAt) return true;
  if (!info.requiredAt) return true;
  return Date.now() - new Date(info.requiredAt).getTime() < EMAIL_VERIFICATION_GRACE_MS;
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
    const hasSupporterAccess = isSubscriberTier(req.tier) && isEmailVerificationOk(req);
    if (!hasSupporterAccess && !hasScopedVaultAccess(req, media.id, projectId)) {
      return {
        allowed: false,
        error: isSubscriberTier(req.tier) ? 'Email verification required' : 'Supporter access required',
      };
    }
  }

  if (media.visibility === 'vault') {
    if (isSubscriberTier(req.tier) && allAccessTierIncludesVault() && isEmailVerificationOk(req)) {
      return { allowed: true };
    }

    if (!hasScopedVaultAccess(req, media.id, projectId)) {
      const listenerId = req.tokenRow?.listener_id || null;
      const result = canAccessVaultContent(listenerId, media.id, { emailVerified: isEmailVerificationOk(req) });
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

  // Creator opt-in per track: anyone who can access it may fetch the full file
  // (used for browser-side offline saves), regardless of subscriber tier.
  if (media.offline_allowed === 1) {
    return canAccessMedia(req, media, projectId);
  }

  if (!isSubscriberTier(req.tier) || !isEmailVerificationOk(req)) {
    return { allowed: false, error: 'Subscriber access required' };
  }

  return { allowed: true };
}

module.exports = {
  SUBSCRIBER_TIERS,
  isSubscriberTier,
  isHigherTier,
  hasScopedVaultAccess,
  allAccessTierIncludesVault,
  isEmailVerificationOk,
  canAccessMedia,
  canDownloadMedia,
};
