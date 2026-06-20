/**
 * api.js — Centralized fetch layer for creator.html.
 *
 * Internal helpers (_fetch, _json, _send) are not exported.
 * All auth uses httpOnly cookies; no client-side tokens in headers
 * except the one-time X-Dashboard-Token exchange in auth.dashboardLogin().
 */

// ── Internal helpers ─────────────────────────────────────────────────────────────

/** Base fetch wrapper — returns raw Response. */
function _fetch(url, opts = {}) {
  return fetch(url, opts);
}

/** GET → parsed JSON. Throws on network error; returns whatever the server sends. */
async function _json(url) {
  return _fetch(url).then(r => r.json());
}

/**
 * POST/PUT/PATCH with a JSON body → { res, data }.
 * Callers check res.ok when they care about HTTP status.
 */
async function _send(url, body, method = 'POST') {
  const res = await _fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

/** DELETE → { res, data }. */
async function _del(url) {
  const res = await _fetch(url, { method: 'DELETE' });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

// ── api.stream ────────────────────────────────────────────────────────────────────

export const stream = {
  /**
   * GET /api/stream/status
   * @returns {{ nowPlaying, listenerCount, mode, recentlyPlayed, liveActive, isVideo, station }}
   */
  status() {
    return _json('/api/stream/status');
  },

  /**
   * POST /api/stream/ping — listener keep-alive; fire-and-forget.
   * @returns {Promise<void>}
   */
  async ping() {
    await _fetch('/api/stream/ping', { method: 'POST' });
  },

  /**
   * GET /api/health — bootstrap: station name + runtime health.
   * @returns {{ station: string, ffmpeg: object }}
   */
  health() {
    return _json('/api/health');
  },
};

// ── api.library ───────────────────────────────────────────────────────────────────

export const library = {
  /**
   * GET /api/library/structure
   * @returns {{ projects: Array, standalone: Array }}
   */
  structure() {
    return _json('/api/library/structure');
  },

  /**
   * GET /api/library/{id} — track metadata (album, producer, credits, bpm).
   * Returns null if not found or request fails (caller must handle).
   * @param {number} id
   * @returns {Promise<object|null>}
   */
  async track(id) {
    const res = await _fetch(`/api/library/${id}`);
    return res.ok ? res.json() : null;
  },

  /**
   * GET /api/creator/profile — public creator bio/profile (player-side).
   * @returns {{ enabled, creatorName, stationName, bio, social, latestTrack, creatorSince, profilePicUrl }}
   */
  creatorProfile() {
    return _json('/api/creator/profile');
  },

  /**
   * GET /api/schedule/current — next scheduled broadcast block (player-side).
   * @returns {{ label, start_time, end_time } | null}
   */
  scheduleCurrent() {
    return _json('/api/schedule/current');
  },
};

// ── api.auth ──────────────────────────────────────────────────────────────────────

export const auth = {
  /**
   * GET /api/tokens/me — current listener tier from cookie.
   * @returns {{ tier: 'free'|'subscriber'|'pro'|'all_access' }}
   */
  me() {
    return _json('/api/tokens/me');
  },

  /**
   * GET /api/listener/me — current listener account details.
   * Throws/rejects when no listener account exists (creator-issued tokens).
   * @returns {{ email: string, hasPassword: boolean }}
   */
  listenerMe() {
    return _json('/api/listener/me');
  },

  /**
   * POST /api/listener/login
   * @param {string} email
   * @param {string} password
   * @returns {{ res: Response, data: { error?: string } }}
   */
  login(email, password) {
    return _send('/api/listener/login', { email, password });
  },

  /**
   * POST /api/listener/register
   * @param {string} email
   * @param {string} password
   * @returns {{ res: Response, data: { error?: string } }}
   */
  register(email, password) {
    return _send('/api/listener/register', { email, password });
  },

  /**
   * POST /api/listener/logout — clears pw_token cookie.
   * @returns {Promise<void>}
   */
  async logout() {
    await _fetch('/api/listener/logout', { method: 'POST' });
  },

  /**
   * PATCH /api/listener/password — set/change listener account password.
   * @param {string} password
   * @returns {{ res: Response, data: { error?: string } }}
   */
  setPassword(password) {
    return _send('/api/listener/password', { password }, 'PATCH');
  },

  /**
   * POST /api/auth/dashboard/login — exchange dashboard token for session cookie.
   * On success returns {} or { requires2FA: true, challenge: string }.
   * @param {string} token
   * @returns {{ res: Response, data: { requires2FA?: boolean, challenge?: string, error?: string } }}
   */
  async dashboardLogin(token) {
    const res = await _fetch('/api/auth/dashboard/login', {
      method: 'POST',
      headers: { 'X-Dashboard-Token': token },
    });
    const data = await res.json().catch(() => ({}));
    return { res, data };
  },

  /**
   * POST /api/auth/dashboard/verify-2fa — complete 2FA challenge.
   * @param {string} challenge
   * @param {string} code
   * @returns {{ res: Response, data: { error?: string } }}
   */
  dashboardVerify2fa(challenge, code) {
    return _send('/api/auth/dashboard/verify-2fa', { challenge, code });
  },
};

// ── api.payment ───────────────────────────────────────────────────────────────────

export const payment = {
  /**
   * GET /api/payment/tip-config — listener-facing tip preset amounts.
   * @returns {{ enabled: boolean, amounts: number[] }}
   */
  tipConfig() {
    return _json('/api/payment/tip-config');
  },

  /**
   * POST /api/payment/tip — create a Stripe tip checkout session.
   * @param {number} amountCents
   * @returns {{ res: Response, data: { checkoutUrl?: string, error?: string } }}
   */
  sendTip(amountCents) {
    return _send('/api/payment/tip', { amountCents });
  },

  /**
   * GET /api/payment/checkout-url?tier={tier} — Stripe subscription checkout URL.
   * Pass tier='subscriber'|'pro'|'all_access'. Omit tier for default subscriber.
   * @param {string} [tier]
   * @returns {{ checkoutUrl: string }}
   */
  checkoutUrl(tier) {
    const url = '/api/payment/checkout-url' + (tier ? `?tier=${encodeURIComponent(tier)}` : '');
    return _json(url);
  },

  /**
   * GET /api/vault/unlock-options/{id} — vault gate options for a track.
   * @param {number} id
   * @returns {{ isVault: boolean, alreadyUnlocked: boolean, unlockOptions: object }}
   */
  vaultUnlockOptions(id) {
    return _json(`/api/vault/unlock-options/${id}`);
  },

  /**
   * POST /api/vault/unlock — initiate a vault unlock checkout.
   * @param {{ unlock_type, amount, payment_type, target_id?, recurring_interval? }} body
   * @returns {{ checkoutUrl: string }}
   */
  async vaultUnlock(body) {
    const { data } = await _send('/api/vault/unlock', body);
    return data;
  },
};

// ── api.share ─────────────────────────────────────────────────────────────────────

export const share = {
  /**
   * GET /api/share/{token} — resolve a public share link (no auth required).
   * @param {string} token
   * @returns {{ label, createdAt, expiresAt, target_type, track?, project? }}
   */
  resolve(token) {
    return _json(`/api/share/${token}`);
  },
};

// ── api.dashboard ─────────────────────────────────────────────────────────────────

export const dashboard = {
  /**
   * GET /api/dashboard/vault — auth probe (just checks response.ok).
   * @returns {Promise<boolean>}
   */
  async check() {
    try { return (await _fetch('/api/dashboard/vault')).ok; } catch { return false; }
  },

  /**
   * GET /api/dashboard/runtime — FFmpeg health check.
   * @returns {{ ffmpeg: { ok: boolean, message?: string } }}
   */
  runtime() {
    return _json('/api/dashboard/runtime');
  },

  /**
   * GET /api/dashboard/accounts — all listener accounts (for typeahead).
   * @returns {Array<{ email: string }>}
   */
  accounts() {
    return _json('/api/dashboard/accounts');
  },

  /**
   * GET /api/dashboard/payment-config — Stripe + PayPal config status.
   * @returns {{ stripe: object, paypal: object }}
   */
  paymentConfig() {
    return _json('/api/dashboard/payment-config');
  },

  /**
   * GET /api/dashboard/creator-type — current creator type config.
   * @returns {{ creatorType: string }}
   */
  creatorType() {
    return _json('/api/dashboard/creator-type');
  },

  /**
   * GET /api/dashboard/radio-host — radio host mode status.
   * @returns {{ radioHost: boolean, locked: boolean, switches: number }}
   */
  radioHostStatus() {
    return _json('/api/dashboard/radio-host');
  },

  /**
   * POST /api/dashboard/radio-host — toggle radio host mode.
   * @returns {{ radioHost: boolean, locked: boolean, switches: number, error?: string }}
   */
  async toggleRadioHost() {
    const { data } = await _send('/api/dashboard/radio-host', {});
    return data;
  },

  /**
   * GET /api/dashboard/external-search?platform={platform}&q={q}
   * @param {string} platform
   * @param {string} q
   * @returns {{ items: Array }}
   */
  externalSearch(platform, q) {
    return _json(`/api/dashboard/external-search?platform=${encodeURIComponent(platform)}&q=${encodeURIComponent(q)}`);
  },

  // ── Station ────────────────────────────────────────────────────────────────────

  station: {
    /**
     * GET /api/dashboard/station
     * @returns {{ slug: string, url: string }}
     */
    get() {
      return _json('/api/dashboard/station');
    },

    /**
     * GET /api/dashboard/station/health
     * @returns {{ reachable: boolean, latencyMs?: number, error?: string }}
     */
    health() {
      return _json('/api/dashboard/station/health');
    },

    /**
     * PUT /api/dashboard/station/url
     * @param {string} url
     * @returns {{ res: Response, data: { error?: string } }}
     */
    updateUrl(url) {
      return _send('/api/dashboard/station/url', { url }, 'PUT');
    },
  },

  // ── Media ──────────────────────────────────────────────────────────────────────

  media: {
    /**
     * GET /api/dashboard/media — full media list.
     * @returns {Array<object>}
     */
    list() {
      return _json('/api/dashboard/media');
    },

    /**
     * PATCH /api/dashboard/media/{id}
     * @param {number} id
     * @param {object} body  e.g. { visibility } or metadata fields
     * @returns {{ res: Response, data: object }}
     */
    update(id, body) {
      return _send(`/api/dashboard/media/${id}`, body, 'PATCH');
    },

    /**
     * POST /api/dashboard/media/{id}/artwork — multipart artwork upload.
     * @param {number} id
     * @param {FormData} formData  — must contain field 'artwork'
     * @returns {{ res: Response }}
     */
    async uploadArtwork(id, formData) {
      const res = await _fetch(`/api/dashboard/media/${id}/artwork`, { method: 'POST', body: formData });
      const data = await res.json().catch(() => ({}));
      return { res, data };
    },

    /**
     * POST /api/dashboard/media/external — import an external track.
     * @param {{ title, artist, platform, externalUrl, duration }} body
     * @returns {{ res: Response, data: object }}
     */
    importExternal(body) {
      return _send('/api/dashboard/media/external', body);
    },

    /**
     * POST /api/dashboard/upload — multipart media file upload.
     * @param {FormData} formData  — must contain fields: media, category, visibility
     * @returns {Response}
     */
    upload(formData) {
      return _fetch('/api/dashboard/upload', { method: 'POST', body: formData });
    },
  },

  // ── Broadcast ──────────────────────────────────────────────────────────────────

  broadcast: {
    /**
     * POST /api/dashboard/broadcast/mode
     * @param {'shuffle'|'scheduled'} mode
     * @returns {{ res: Response, data: object }}
     */
    setMode(mode) {
      return _send('/api/dashboard/broadcast/mode', { mode });
    },

    /**
     * POST /api/dashboard/broadcast/restart
     * @returns {Response}
     */
    restart() {
      return _fetch('/api/dashboard/broadcast/restart', { method: 'POST' });
    },

    /**
     * GET /api/dashboard/broadcast/queue
     * @returns {{ queue: Array<{ mediaId: number, title?: string }> }}
     */
    getQueue() {
      return _json('/api/dashboard/broadcast/queue');
    },

    /**
     * POST /api/dashboard/broadcast/queue
     * @param {number} mediaId
     * @returns {{ res: Response, data: { count: number, error?: string } }}
     */
    enqueue(mediaId) {
      return _send('/api/dashboard/broadcast/queue', { mediaId });
    },

    /**
     * DELETE /api/dashboard/broadcast/queue/{idx}
     * @param {number} idx
     * @returns {{ res: Response, data: object }}
     */
    removeFromQueue(idx) {
      return _del(`/api/dashboard/broadcast/queue/${idx}`);
    },
  },

  // ── Schedule ───────────────────────────────────────────────────────────────────

  schedule: {
    /**
     * GET /api/schedule — all schedule blocks.
     * @returns {Array<object>}
     */
    list() {
      return _json('/api/schedule');
    },

    /**
     * POST /api/schedule/blocks
     * @param {object} body
     * @returns {{ res: Response, data: object }}
     */
    createBlock(body) {
      return _send('/api/schedule/blocks', body);
    },

    /**
     * PUT /api/schedule/blocks/{id}
     * @param {number} id
     * @param {object} body
     * @returns {{ res: Response, data: { error?: string } }}
     */
    updateBlock(id, body) {
      return _send(`/api/schedule/blocks/${id}`, body, 'PUT');
    },

    /**
     * DELETE /api/schedule/blocks/{id}
     * @param {number} id
     * @returns {{ res: Response, data: object }}
     */
    deleteBlock(id) {
      return _del(`/api/schedule/blocks/${id}`);
    },
  },

  // ── Vault projects ─────────────────────────────────────────────────────────────

  vault: {
    /**
     * GET /api/dashboard/vault/pricing — projects with pricing + items.
     * @returns {{ projects: Array }}
     */
    pricing() {
      return _json('/api/dashboard/vault/pricing');
    },

    /**
     * POST /api/dashboard/vault/projects
     * @param {object} body
     * @returns {{ res: Response, data: object }}
     */
    createProject(body) {
      return _send('/api/dashboard/vault/projects', body);
    },

    /**
     * DELETE /api/dashboard/vault/projects/{id}
     * @param {number} id
     * @returns {{ res: Response, data: object }}
     */
    deleteProject(id) {
      return _del(`/api/dashboard/vault/projects/${id}`);
    },

    /**
     * POST /api/dashboard/vault/projects/{projId}/items
     * @param {number} projId
     * @param {object} body
     * @returns {{ res: Response, data: object }}
     */
    addTrack(projId, body) {
      return _send(`/api/dashboard/vault/projects/${projId}/items`, body);
    },

    /**
     * DELETE /api/dashboard/vault/projects/{projId}/items/{contentId}
     * @param {number} projId
     * @param {number} contentId
     * @returns {{ res: Response, data: object }}
     */
    removeTrack(projId, contentId) {
      return _del(`/api/dashboard/vault/projects/${projId}/items/${contentId}`);
    },

    /**
     * GET /api/dashboard/vault/highlight
     * @returns {{ highlight_type: string|null, highlight_id: number|null }}
     */
    getHighlight() {
      return _json('/api/dashboard/vault/highlight');
    },

    /**
     * PUT /api/dashboard/vault/highlight
     * @param {{ type: 'track'|'project'|null, id: number|null }} body
     * @returns {{ res: Response, data: object }}
     */
    setHighlight(body) {
      return _send('/api/dashboard/vault/highlight', body, 'PUT');
    },
  },

  // ── Share links ────────────────────────────────────────────────────────────────

  share: {
    /**
     * GET /api/dashboard/share — all share links.
     * @returns {Array<object>}
     */
    list() {
      return _json('/api/dashboard/share');
    },

    /**
     * POST /api/dashboard/share
     * @param {{ target_type: 'track'|'project', target_id: number, label?: string, expires_in_hours?: number }} body
     * @returns {{ res: Response, data: object }}
     */
    create(body) {
      return _send('/api/dashboard/share', body);
    },

    /**
     * DELETE /api/dashboard/share/{token}
     * @param {string} token
     * @returns {{ res: Response, data: object }}
     */
    remove(token) {
      return _del(`/api/dashboard/share/${token}`);
    },
  },

  // ── Tokens ─────────────────────────────────────────────────────────────────────

  tokens: {
    /**
     * GET /api/dashboard/tokens — all tokens.
     * @returns {Array<object>}
     */
    list() {
      return _json('/api/dashboard/tokens');
    },

    /**
     * POST /api/dashboard/tokens — create a token (global or scoped).
     * @param {{ label, tier, scope_type?, scope_id? }} body
     * @returns {{ res: Response, data: { token?: string, id?: number, error?: string } }}
     */
    create(body) {
      return _send('/api/dashboard/tokens', body);
    },

    /**
     * DELETE /api/dashboard/tokens/{id} — revoke a token.
     * @param {number} id
     * @returns {{ res: Response, data: object }}
     */
    revoke(id) {
      return _del(`/api/dashboard/tokens/${id}`);
    },

    /**
     * PATCH /api/dashboard/tokens/{id}/tier
     * @param {number} id
     * @param {object} body  e.g. { tier, email }
     * @returns {{ res: Response, data: object }}
     */
    setTier(id, body) {
      return _send(`/api/dashboard/tokens/${id}/tier`, body, 'PATCH');
    },

    /**
     * GET /api/dashboard/tokens/for/{scopeType}/{scopeId}
     * @param {string} scopeType
     * @param {number} scopeId
     * @returns {Array<object>}
     */
    forScope(scopeType, scopeId) {
      return _json(`/api/dashboard/tokens/for/${scopeType}/${scopeId}`);
    },

    /**
     * GET /api/dashboard/tokens/{id}/assignments
     * @param {number} id
     * @returns {Array<object>}
     */
    assignments(id) {
      return _json(`/api/dashboard/tokens/${id}/assignments`);
    },

    /**
     * POST /api/dashboard/tokens/{id}/assignments
     * @param {number} id
     * @param {object} body
     * @returns {{ res: Response, data: { id?: number, error?: string } }}
     */
    assign(id, body) {
      return _send(`/api/dashboard/tokens/${id}/assignments`, body);
    },

    /**
     * DELETE /api/dashboard/tokens/{tokenId}/assignments/{assignId}
     * @param {number} tokenId
     * @param {number} assignId
     * @returns {{ res: Response, data: object }}
     */
    unassign(tokenId, assignId) {
      return _del(`/api/dashboard/tokens/${tokenId}/assignments/${assignId}`);
    },
  },

  // ── Analytics ──────────────────────────────────────────────────────────────────

  analytics: {
    /**
     * GET /api/analytics/live
     * @returns {{ listeners: number, ... }}
     */
    live() {
      return _json('/api/analytics/live');
    },

    /**
     * GET /api/analytics/top?limit={limit}&period={period}
     * @param {number} [limit=3]
     * @param {string} [period]  e.g. '30d'
     * @returns {Array<{ title, filename, play_count }>}
     */
    top(limit = 3, period) {
      const q = new URLSearchParams({ limit: String(limit) });
      if (period) q.set('period', period);
      return _json(`/api/analytics/top?${q}`);
    },

    /**
     * GET /api/analytics/history?days={days}
     * @param {number} days
     * @returns {Array<{ date, unique_listeners }>}
     */
    history(days) {
      return _json(`/api/analytics/history?days=${days}`);
    },

    /**
     * GET /api/analytics/playcounts — map of mediaId → play count.
     * @returns {Record<string, number>}
     */
    playcounts() {
      return _json('/api/analytics/playcounts');
    },
  },

  // ── 2FA ────────────────────────────────────────────────────────────────────────

  twoFA: {
    /**
     * GET /api/dashboard/2fa/status
     * @returns {{ enabled: boolean }}
     */
    status() {
      return _json('/api/dashboard/2fa/status');
    },

    /**
     * POST /api/dashboard/2fa/setup — generate TOTP secret + QR code.
     * Returns the secret once; it will not be shown again.
     * @returns {{ secret, qrDataUrl, recoveryCodes }}
     */
    setup() {
      return _fetch('/api/dashboard/2fa/setup', { method: 'POST' }).then(r => r.json());
    },

    /**
     * POST /api/dashboard/2fa/confirm — confirm TOTP code to activate 2FA.
     * @param {string} code
     * @returns {{ res: Response, data: { recoveryCodes?: string[], error?: string } }}
     */
    confirm(code) {
      return _send('/api/dashboard/2fa/confirm', { code });
    },

    /**
     * DELETE /api/dashboard/2fa — disable 2FA; code sent as JSON body.
     * @param {string} code
     * @returns {{ res: Response, data: { error?: string } }}
     */
    async disable(code) {
      const res = await _fetch('/api/dashboard/2fa', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const data = await res.json().catch(() => ({}));
      return { res, data };
    },
  },

  // ── Tip config ─────────────────────────────────────────────────────────────────

  tipConfig: {
    /**
     * GET /api/dashboard/tip-config
     * @returns {{ amounts: number[], customEnabled: boolean }}
     */
    get() {
      return _json('/api/dashboard/tip-config');
    },

    /**
     * PUT /api/dashboard/tip-config
     * @param {{ amounts: number[], customEnabled: boolean }} body
     * @returns {{ res: Response, data: object }}
     */
    update(body) {
      return _send('/api/dashboard/tip-config', body, 'PUT');
    },
  },

  // ── Live broadcast ─────────────────────────────────────────────────────────────

  live: {
    /**
     * GET /api/dashboard/live/status
     * @returns {{ isLive: boolean }}
     */
    status() {
      return _json('/api/dashboard/live/status');
    },

    /**
     * POST /api/dashboard/live/start — start a live HLS session.
     * @returns {{ res: Response, data: { error?: string } }}
     */
    async start() {
      const res = await _fetch('/api/dashboard/live/start', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      return { res, data };
    },

    /**
     * POST /api/dashboard/live/chunk — send a raw PCM audio chunk (Int16Array.buffer).
     * Content-Type is octet-stream; body is an ArrayBuffer from the AudioWorklet.
     * @param {ArrayBuffer} buffer
     * @returns {Response}
     */
    sendChunk(buffer) {
      return _fetch('/api/dashboard/live/chunk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: buffer,
      });
    },

    /**
     * POST /api/dashboard/live/stop
     * @returns {Promise<void>}
     */
    async stop() {
      await _fetch('/api/dashboard/live/stop', { method: 'POST' });
    },
  },

  // ── Creator profile (dashboard) ────────────────────────────────────────────────

  creator: {
    /**
     * GET /api/creator/dashboard/profile
     * @returns {{ bio_enabled, bio, social_*, profile_pic_url }}
     */
    profile() {
      return _json('/api/creator/dashboard/profile');
    },

    /**
     * POST /api/creator/dashboard/profile
     * @param {object} body
     * @returns {{ res: Response, data: object }}
     */
    updateProfile(body) {
      return _send('/api/creator/dashboard/profile', body);
    },

    /**
     * POST /api/creator/dashboard/pic — multipart profile picture upload.
     * @param {FormData} formData  — must contain field 'pic'
     * @returns {Response}
     */
    uploadPic(formData) {
      return _fetch('/api/creator/dashboard/pic', { method: 'POST', body: formData });
    },
  },

  // ── System ─────────────────────────────────────────────────────────────────────

  system: {
    /**
     * GET /api/system/launch-status
     * @returns {{ accepted: boolean }}
     */
    launchStatus() {
      return _json('/api/system/launch-status');
    },

    /**
     * POST /api/system/launch-accept
     * @returns {Promise<void>}
     */
    async launchAccept() {
      await _fetch('/api/system/launch-accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
    },
  },
};
