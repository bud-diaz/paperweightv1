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

import { state, HLS_URL, HLS_LIVE_URL, HLS_RETRY_DELAYS_MS, PING_INTERVAL_MS } from './state.js';
import { el } from './utils.js';
import * as api from './api.js';

// ── Module-local state ────────────────────────────────────────────────────────────
// These are owned here; do not also import them from state.js.

let hls             = null;
let hlsRetryTimer   = null;
let hlsRetryAttempt = 0;
let pingInterval    = null;
let currentIsVideo    = false;
let currentLiveActive = false;
let stationName       = '';

// ── Injected callbacks (registered by player.js and ascii.js in Phase 8) ─────────
// Defaults are no-ops so the module is safe to call before wiring.

let _render           = () => {};
let _asciiStart       = () => {};
let _asciiStop        = () => {};
let _asciiLoadArtwork = () => {};

/**
 * Register callbacks to break the circular dependency with player.js.
 * player.js calls this during init, passing its own render() and the
 * ascii functions (which arrive from ascii.js in Phase 5).
 *
 * @param {{ onRender, onAsciiStart, onAsciiStop, onAsciiLoadArtwork }} callbacks
 */
export function init({ onRender, onAsciiStart, onAsciiStop, onAsciiLoadArtwork } = {}) {
  if (onRender)           _render           = onRender;
  if (onAsciiStart)       _asciiStart       = onAsciiStart;
  if (onAsciiStop)        _asciiStop        = onAsciiStop;
  if (onAsciiLoadArtwork) _asciiLoadArtwork = onAsciiLoadArtwork;
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
  return currentIsVideo ? el('video-el') : el('audio-el');
}

export function activeHlsUrl() {
  return currentLiveActive ? HLS_LIVE_URL : HLS_URL;
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
      try { hls.stopLoad(); } catch {}
      hls.loadSource(url);
      hls.startLoad();
    } else if (mediaEl) {
      mediaEl.src = url;
      mediaEl.load();
      if (state.playing) mediaEl.play().catch(() => {});
    }
  }, delay);
}

// ── HLS.js setup ──────────────────────────────────────────────────────────────────

export function setupHls(mediaEl) {
  if (window.Hls && Hls.isSupported()) {
    resetHlsRetry();
    hls = new Hls({ lowLatencyMode: false });
    hls.loadSource(activeHlsUrl());
    hls.attachMedia(mediaEl);
    hls.on(Hls.Events.MANIFEST_LOADED, resetHlsRetry);
    hls.on(Hls.Events.ERROR, (_, d) => {
      if (d.fatal) scheduleHlsRetry();
    });
  } else if (mediaEl.canPlayType('application/vnd.apple.mpegurl')) {
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

    // Handle audio ↔ video switch
    const wasVideo = currentIsVideo;
    currentIsVideo = !!data.isVideo;
    if (wasVideo !== currentIsVideo && hls && state.playing) {
      clearHlsRetry();
      hls.destroy(); hls = null;
      const oldEl = wasVideo ? el('video-el') : el('audio-el');
      const newEl = currentIsVideo ? el('video-el') : el('audio-el');
      oldEl.pause();
      oldEl.hidden = true;
      setupHls(newEl);
      if (currentIsVideo) newEl.hidden = false;
      newEl.play().catch(() => {});
    }

    // Handle regular ↔ live stream switch
    const prevLive = currentLiveActive;
    currentLiveActive = !!data.liveActive;
    if (currentLiveActive !== prevLive && state.playing) {
      const targetUrl = activeHlsUrl();
      resetHlsRetry();
      if (hls) { hls.loadSource(targetUrl); }
      else {
        const mediaEl = currentIsVideo ? el('video-el') : el('audio-el');
        if (mediaEl) mediaEl.src = targetUrl;
      }
    }

    if (data.station) stationName = data.station;
    state.nowPlaying    = data.nowPlaying || null;
    state.listenerCount = data.listenerCount || 0;

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
