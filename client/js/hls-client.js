/**
 * hls-client.js — HLS.js lifecycle, stream status polling, and ping.
 *
 * Owns local state for: hls, hlsRetryTimer, hlsRetryAttempt, pingInterval,
 * currentIsVideo, currentLiveActive, stationName.
 * These shadow the state.js declarations; state.js values are the documented
 * initial values only. The HLS client is the sole mutator of these fields.
 *
 * render() and ASCII callbacks are injected via init() to avoid a circular
 * import with player.js (player imports hls-client, not the other way around).
 */

import { state, authState, HLS_URL, HLS_LIVE_URL, HLS_LIVE_VIDEO_URL, HLS_RETRY_DELAYS_MS, PING_INTERVAL_MS } from './state.js';
import { el } from './utils.js';
import * as api from './api.js';

// ── Module-local state ────────────────────────────────────────────────────────────
// These are owned here; do not also import them from state.js.

let hls             = null;
let usingNativeHls  = false;
let hlsRetryTimer   = null;
let hlsRetryAttempt = 0;
let pingInterval    = null;
let currentIsVideo    = false;
let currentLiveActive = false;
let stationName       = '';

// Paid-tier live video (src/broadcast/liveVideo.js). Independent of the
// audio-only currentLiveActive above; when active it takes priority over
// both the station broadcast and the audio-only live stream for playback.
let currentVideoLiveActive = false;
let videoLiveMinTier       = 'subscriber';

const TIER_RANK = { free: 0, subscriber: 1, pro: 2, all_access: 3 };

// True once we know the listener's tier meets the creator-configured minimum.
// This is a UX check only — the real access boundary is the server-side
// /hls/live-video gate (src/index.js), which enforces this independent of
// what the client believes.
function hasVideoLiveAccess() {
  return (TIER_RANK[authState.tier] ?? 0) >= (TIER_RANK[videoLiveMinTier] ?? 0);
}

// ── Injected callbacks (registered by player.js and ascii.js in Phase 8) ─────────
// Defaults are no-ops so the module is safe to call before wiring.

let _render           = () => {};
let _asciiStart       = () => {};
let _asciiStop        = () => {};
let _asciiLoadArtwork = () => {};
let _onNowPlayingChange = () => {};

/**
 * Register callbacks to break the circular dependency with player.js.
 * player.js calls this during init, passing its own render() and the
 * ascii functions (which arrive from ascii.js in Phase 5).
 *
 * @param {{ onRender, onAsciiStart, onAsciiStop, onAsciiLoadArtwork }} callbacks
 */
export function init({ onRender, onAsciiStart, onAsciiStop, onAsciiLoadArtwork, onNowPlayingChange } = {}) {
  if (onRender)           _render           = onRender;
  if (onAsciiStart)       _asciiStart       = onAsciiStart;
  if (onAsciiStop)        _asciiStop        = onAsciiStop;
  if (onAsciiLoadArtwork) _asciiLoadArtwork = onAsciiLoadArtwork;
  if (onNowPlayingChange) _onNowPlayingChange = onNowPlayingChange;
}

// ── Getters for state player.js needs to read ─────────────────────────────────────

/** Returns the active Hls.js instance, or null. */
export function getHls() { return hls; }

/** True when the current stream is video. */
export function isVideoMode() { return currentIsVideo; }

/** True when a live override stream is active. */
export function isLiveActive() { return currentLiveActive; }

/** Current station name received from the server. */
export function getStationName() { return stationName; }

/** True when the ping interval is running. */
export function isPingActive() { return !!pingInterval; }

// ── Media element helpers ─────────────────────────────────────────────────────────

export function activeMediaEl() {
  if (currentVideoLiveActive && hasVideoLiveAccess()) return el('video-el');
  return currentIsVideo ? el('video-el') : el('audio-el');
}

export function activeHlsUrl() {
  if (currentVideoLiveActive && hasVideoLiveAccess()) return HLS_LIVE_VIDEO_URL;
  return currentLiveActive ? HLS_LIVE_URL : HLS_URL;
}

function destroyHls() {
  if (!hls) return;
  try { hls.destroy(); } catch {}
  hls = null;
}

function resetMediaEl(mediaEl) {
  if (!mediaEl) return;
  try { mediaEl.pause(); } catch {}
  try {
    mediaEl.removeAttribute('src');
    mediaEl.load();
  } catch {}
}

// ── HLS retry ─────────────────────────────────────────────────────────────────────

export function clearHlsRetry() {
  if (hlsRetryTimer) {
    clearTimeout(hlsRetryTimer);
    hlsRetryTimer = null;
  }
}

export function resetHlsRetry() {
  clearHlsRetry();
  hlsRetryAttempt = 0;
}

export function scheduleHlsRetry() {
  if (hlsRetryTimer) return;
  const delay = HLS_RETRY_DELAYS_MS[Math.min(hlsRetryAttempt, HLS_RETRY_DELAYS_MS.length - 1)];
  hlsRetryAttempt++;
  el('track-creator').textContent = 'Stream reconnecting...';
  hlsRetryTimer = setTimeout(() => {
    hlsRetryTimer = null;
    const mediaEl = activeMediaEl();
    const url = activeHlsUrl();
    if (hls) {
      destroyHls();
      setupHls(mediaEl, { keepRetryState: true });
    } else if (mediaEl) {
      mediaEl.src = url;
      mediaEl.load();
    }
    if (state.playing && mediaEl) mediaEl.play().catch(() => {});
  }, delay);
}

// ── HLS.js setup ──────────────────────────────────────────────────────────────────

export function setupHls(mediaEl, { keepRetryState = false } = {}) {
  if (!mediaEl) return;
  if (window.Hls && Hls.isSupported()) {
    if (!keepRetryState) resetHlsRetry();
    usingNativeHls = false;
    hls = new Hls({ lowLatencyMode: false });
    hls.loadSource(activeHlsUrl());
    hls.attachMedia(mediaEl);
    hls.on(Hls.Events.MANIFEST_LOADED, resetHlsRetry);
    hls.on(Hls.Events.ERROR, (_, d) => {
      if (d.fatal) scheduleHlsRetry();
    });
  } else if (mediaEl.canPlayType('application/vnd.apple.mpegurl')) {
    usingNativeHls = true;
    mediaEl.src = activeHlsUrl();
  }
}

// ── Ping interval management ──────────────────────────────────────────────────────

export async function ping() {
  try { await api.stream.ping(); } catch {}
}

export function startPingInterval() {
  if (!pingInterval) pingInterval = setInterval(ping, PING_INTERVAL_MS);
}

export function stopPingInterval() {
  clearInterval(pingInterval);
  pingInterval = null;
}

// ── Stream status polling ─────────────────────────────────────────────────────────

export async function fetchStreamStatus() {
  try {
    const data = await api.stream.status();

    // Paid-tier live video takes priority over everything below when the
    // listener's tier meets the creator-configured minimum; otherwise a CTA
    // overlay stands in for playback and the gated URL is never requested.
    const videoLive = data.videoLive || {};
    videoLiveMinTier = videoLive.minTier || 'subscriber';
    const wasVideoLive = currentVideoLiveActive;
    currentVideoLiveActive = !!videoLive.active;
    const showingGatedVideo = currentVideoLiveActive && hasVideoLiveAccess();
    const showingCta        = currentVideoLiveActive && !hasVideoLiveAccess();

    const ctaEl = el('live-video-cta');
    if (ctaEl) ctaEl.hidden = !showingCta;

    if (showingCta) {
      if (hls || usingNativeHls) { clearHlsRetry(); destroyHls(); }
      resetMediaEl(el('video-el'));
      resetMediaEl(el('audio-el'));
      el('video-el').hidden = true;
      el('audio-el').hidden = true;
    } else if (showingGatedVideo) {
      const enteringVideoLive = !wasVideoLive || !(hls || usingNativeHls);
      if (enteringVideoLive && state.playing) {
        clearHlsRetry();
        destroyHls();
        resetMediaEl(el('audio-el'));
        el('audio-el').hidden = true;
        setupHls(el('video-el'));
        el('video-el').hidden = false;
        el('video-el').play().catch(() => {});
      }
    } else {
      // Video live isn't overriding playback — run the normal audio↔video and
      // regular↔live swaps exactly as before. Also covers the moment video
      // live just ended (wasVideoLive true, now false): whichever of these
      // two blocks fires restores the correct station/live-audio source.
      const wasVideo = currentIsVideo;
      currentIsVideo = !!data.isVideo;
      if ((wasVideo !== currentIsVideo || wasVideoLive) && (hls || usingNativeHls) && state.playing) {
        clearHlsRetry();
        destroyHls();
        const oldEl = wasVideoLive ? el('video-el') : (wasVideo ? el('video-el') : el('audio-el'));
        const newEl = currentIsVideo ? el('video-el') : el('audio-el');
        resetMediaEl(oldEl);
        oldEl.hidden = true;
        setupHls(newEl);
        if (currentIsVideo) newEl.hidden = false;
        newEl.play().catch(() => {});
      }

      // Handle regular ↔ live stream switch
      const prevLive = currentLiveActive;
      currentLiveActive = !!data.liveActive;
      if ((currentLiveActive !== prevLive || wasVideoLive) && state.playing) {
        const targetUrl = activeHlsUrl();
        resetHlsRetry();
        if (hls) { hls.loadSource(targetUrl); }
        else {
          const mediaEl = currentIsVideo ? el('video-el') : el('audio-el');
          if (mediaEl) mediaEl.src = targetUrl;
        }
      }
    }

    const previousNowPlayingId = state.nowPlaying?.id ?? null;
    if (data.station) stationName = data.station;
    state.nowPlaying    = data.nowPlaying || null;
    state.listenerCount = data.listenerCount || 0;
    const nextNowPlayingId = state.nowPlaying?.id ?? null;
    if (previousNowPlayingId && nextNowPlayingId && previousNowPlayingId !== nextNowPlayingId) {
      _onNowPlayingChange(state.nowPlaying, previousNowPlayingId);
    }

    // Delegate to ASCII renderer via injected callbacks
    if (state.playing && data.nowPlaying) {
      const mode = data.nowPlaying.isVideo ? 'video' : 'audio';
      _asciiStart(mode);
      if (mode === 'audio') _asciiLoadArtwork(data.nowPlaying.id);
    } else {
      _asciiStop();
    }

    _render();
  } catch {}
}
