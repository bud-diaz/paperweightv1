/**
 * dashboard/liveVideo.js — Live video (paid-tier) broadcast via RTMP/OBS.
 *
 * Independent of dashboard/live-external.js (the existing audio-only external
 * encoder), which this module otherwise mirrors closely: the server owns the
 * whole capture pipeline, FFmpeg listens for a single inbound RTMP connection,
 * and the dashboard only ever polls /api/dashboard/live-video/status to learn
 * whether it's idle, waiting for an encoder ("pending"), or on air.
 *
 * Desktop-only for the start/stop/RTMP-details controls: the RTMP listener
 * binds to the local machine/LAN, same constraint as the audio external
 * encoder. The minimum-tier and notify settings stay usable on the hosted web
 * platform since they're just creator preferences.
 */

import * as api from '../api.js';
import { el, fmt } from '../utils.js';
import { isDesktopPlatform } from './index.js';

const POLL_MS = 2000;

let pollInt = null;
let timerInt = null;
let startedAtMs = 0;
let lastState = 'idle';

export function init() {}

function renderRtmpFields(rtmp) {
  if (!rtmp) return;
  el('lv-rtmp-url').textContent = rtmp.url || '';
  el('lv-rtmp-key').textContent = rtmp.streamKey || '';
}

function showIdlePanel() {
  el('live-video-onair').hidden = true;
  el('live-video-idle').hidden = false;
  el('live-video-pending').hidden = true;
  el('btn-go-live-video').disabled = false;
}

function showPendingPanel(rtmp) {
  el('live-video-onair').hidden = true;
  el('live-video-idle').hidden = true;
  el('live-video-pending').hidden = false;
  renderRtmpFields(rtmp);
  el('live-video-status').textContent = 'Waiting for OBS to connect…';
}

function stopOnAirTimer() {
  if (timerInt) { clearInterval(timerInt); timerInt = null; }
}

function showOnAir(startedAt) {
  el('live-video-idle').hidden = true;
  el('live-video-pending').hidden = true;
  el('live-video-onair').hidden = false;

  startedAtMs = startedAt ? new Date(startedAt).getTime() : Date.now();
  stopOnAirTimer();
  el('live-video-timer').textContent = fmt(Math.floor((Date.now() - startedAtMs) / 1000));
  timerInt = setInterval(() => {
    el('live-video-timer').textContent = fmt(Math.floor((Date.now() - startedAtMs) / 1000));
  }, 1000);
}

function stopPolling() {
  if (pollInt) { clearInterval(pollInt); pollInt = null; }
}

function startPolling() {
  stopPolling();
  pollInt = setInterval(pollStatus, POLL_MS);
}

async function pollStatus() {
  let data;
  try {
    data = await api.dashboard.liveVideo.status();
  } catch {
    return;
  }
  syncState(data);
}

// Renders whichever panel matches the server-reported state, and reacts to
// transitions (e.g. live -> pending on an OBS disconnect+reconnect, or
// pending -> idle on the wait-timeout auto-cancelling the listener).
function syncState(data) {
  const state = data.state;

  if (state === 'live') {
    if (lastState !== 'live') showOnAir(data.startedAt);
  } else if (state === 'pending') {
    if (lastState === 'live') stopOnAirTimer();
    showPendingPanel(data.rtmp);
    if (lastState === 'live') el('live-video-status').textContent = 'OBS disconnected — waiting for reconnect…';
  } else {
    stopOnAirTimer();
    stopPolling();
    showIdlePanel();
    renderRtmpFields(data.rtmp);
  }

  lastState = state;
}

export function loadDashLiveVideo() {
  loadLiveVideoSettings();
  if (!isDesktopPlatform()) return;
  api.dashboard.liveVideo.status().then(data => {
    renderRtmpFields(data.rtmp);
    lastState = data.state;
    if (data.state === 'live') {
      showOnAir(data.startedAt);
      startPolling();
    } else if (data.state === 'pending') {
      showPendingPanel(data.rtmp);
      startPolling();
    }
  }).catch(() => {});
}

async function startGoLiveVideo() {
  if (!isDesktopPlatform()) return;
  const msgEl = el('live-video-msg');
  msgEl.textContent = '';
  el('btn-go-live-video').disabled = true;
  try {
    const { res, data } = await api.dashboard.liveVideo.start();
    if (!res.ok) {
      msgEl.textContent = data.error || 'Could not start live video broadcast';
      el('btn-go-live-video').disabled = false;
      return;
    }
    lastState = 'pending';
    showPendingPanel(data.rtmp);
    startPolling();
  } catch {
    msgEl.textContent = 'Server error — try again';
    el('btn-go-live-video').disabled = false;
  }
}

async function endLiveVideo() {
  stopPolling();
  stopOnAirTimer();
  try { await api.dashboard.liveVideo.stop(); } catch {}
  lastState = 'idle';
  showIdlePanel();
}

async function regenerateLiveVideoKey() {
  const { res, data } = await api.dashboard.liveVideo.regenerateKey();
  if (!res.ok) {
    el('live-video-msg').textContent = data.error || 'Could not regenerate key';
    return;
  }
  try {
    const status = await api.dashboard.liveVideo.status();
    renderRtmpFields(status.rtmp);
  } catch {}
}

async function copyField(fieldId) {
  const text = el(fieldId).textContent;
  if (!text) return;
  try { await navigator.clipboard.writeText(text); } catch {}
}

// ── Minimum-tier / notify settings (usable on web, not just desktop) ────────

async function loadLiveVideoSettings() {
  try {
    const data = await api.dashboard.liveVideo.settings();
    el('live-video-min-tier').value = data.minTier || 'subscriber';
    el('live-video-notify-toggle').checked = data.notifyEnabled !== false;
  } catch {}
}

async function saveLiveVideoSettings() {
  const minTier = el('live-video-min-tier').value;
  const notifyEnabled = el('live-video-notify-toggle').checked;
  try {
    await api.dashboard.liveVideo.updateSettings({ minTier, notifyEnabled });
  } catch {}
}

export function initLiveVideoHandlers() {
  el('btn-go-live-video').addEventListener('click', startGoLiveVideo);
  el('btn-end-live-video').addEventListener('click', endLiveVideo);
  el('btn-cancel-live-video').addEventListener('click', endLiveVideo);
  el('btn-regen-lv-rtmp-key').addEventListener('click', regenerateLiveVideoKey);
  el('btn-copy-lv-rtmp-url').addEventListener('click', () => copyField('lv-rtmp-url'));
  el('btn-copy-lv-rtmp-key').addEventListener('click', () => copyField('lv-rtmp-key'));
  el('live-video-min-tier').addEventListener('change', saveLiveVideoSettings);
  el('live-video-notify-toggle').addEventListener('change', saveLiveVideoSettings);
}
