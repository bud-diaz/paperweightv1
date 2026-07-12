/**
 * dashboard/live-external.js — External encoder (RTMP, e.g. OBS) broadcast.
 *
 * Unlike mic-live (dashboard/live.js), the server owns the whole capture
 * pipeline: FFmpeg listens for a single inbound RTMP connection and the
 * dashboard only ever polls /api/dashboard/broadcast/external/status to learn
 * whether it's idle, waiting for an encoder ("pending"), or on air.
 */

import * as api from '../api.js';
import { el, fmt } from '../utils.js';

const POLL_MS = 2000;

let pollInt = null;
let timerInt = null;
let startedAtMs = 0;
let lastState = 'idle';

export function init() {}

function setSourceToggle(source) {
  el('btn-source-mic').classList.toggle('active', source === 'mic');
  el('btn-source-external').classList.toggle('active', source === 'external');
  el('live-idle').hidden = source !== 'mic';
  el('live-external').hidden = source !== 'external';
}

function renderRtmpFields(rtmp) {
  if (!rtmp) return;
  el('ext-rtmp-url').textContent = rtmp.url || '';
  el('ext-rtmp-key').textContent = rtmp.streamKey || '';
}

function showIdlePanel() {
  el('live-onair').hidden = true;
  el('live-source-toggle').hidden = false;
  el('live-external-idle').hidden = false;
  el('live-external-pending').hidden = true;
  el('btn-go-live-external').disabled = false;
  el('live-external-status').textContent = 'Waiting for OBS to connect…';
}

function showPendingPanel(rtmp) {
  el('live-onair').hidden = true;
  el('live-source-toggle').hidden = true;
  el('live-external-idle').hidden = true;
  el('live-external-pending').hidden = false;
  renderRtmpFields(rtmp);
  el('live-external-status').textContent = 'Waiting for OBS to connect…';
}

function stopOnAirTimer() {
  if (timerInt) { clearInterval(timerInt); timerInt = null; }
}

function showOnAir(startedAt) {
  el('live-external').hidden = true;
  el('live-source-toggle').hidden = true;
  el('live-onair').hidden = false;
  el('live-onair').dataset.source = 'external';

  startedAtMs = startedAt ? new Date(startedAt).getTime() : Date.now();
  stopOnAirTimer();
  el('live-timer').textContent = fmt(Math.floor((Date.now() - startedAtMs) / 1000));
  timerInt = setInterval(() => {
    el('live-timer').textContent = fmt(Math.floor((Date.now() - startedAtMs) / 1000));
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
    data = await api.dashboard.broadcastExternal.status();
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
    if (lastState === 'live') el('live-external-status').textContent = 'OBS disconnected — waiting for reconnect…';
  } else {
    stopOnAirTimer();
    stopPolling();
    showIdlePanel();
    renderRtmpFields(data.rtmp);
  }

  lastState = state;
}

export function loadDashExternal() {
  api.dashboard.broadcastExternal.status().then(data => {
    renderRtmpFields(data.rtmp);
    lastState = data.state;
    if (data.state === 'live') {
      setSourceToggle('external');
      showOnAir(data.startedAt);
      startPolling();
    } else if (data.state === 'pending') {
      setSourceToggle('external');
      showPendingPanel(data.rtmp);
      startPolling();
    }
  }).catch(() => {});
}

// Called by dashboard/live.js when END BROADCAST is clicked while the
// on-air source was external, so its poll/timer don't keep running after
// the shared stop() call already tore the broadcast down server-side.
export function teardownOnAir() {
  stopOnAirTimer();
  stopPolling();
  lastState = 'idle';
}

async function startGoLiveExternal() {
  const msgEl = el('live-external-msg');
  msgEl.textContent = '';
  el('btn-go-live-external').disabled = true;
  try {
    const { res, data } = await api.dashboard.broadcastExternal.start();
    if (!res.ok) {
      msgEl.textContent = data.error || 'Could not start external broadcast';
      el('btn-go-live-external').disabled = false;
      return;
    }
    lastState = 'pending';
    showPendingPanel(data.rtmp);
    startPolling();
  } catch {
    msgEl.textContent = 'Server error — try again';
    el('btn-go-live-external').disabled = false;
  }
}

async function cancelGoLiveExternal() {
  stopPolling();
  stopOnAirTimer();
  try { await api.dashboard.broadcastExternal.stop(); } catch {}
  lastState = 'idle';
  showIdlePanel();
}

async function regenerateExternalKey() {
  const { res, data } = await api.dashboard.broadcastExternal.regenerateKey();
  if (!res.ok) {
    el('live-external-msg').textContent = data.error || 'Could not regenerate key';
    return;
  }
  try {
    const status = await api.dashboard.broadcastExternal.status();
    renderRtmpFields(status.rtmp);
  } catch {}
}

async function copyField(fieldId) {
  const text = el(fieldId).textContent;
  if (!text) return;
  try { await navigator.clipboard.writeText(text); } catch {}
}

export function initLiveExternalHandlers() {
  el('btn-source-mic').addEventListener('click', () => setSourceToggle('mic'));
  el('btn-source-external').addEventListener('click', () => setSourceToggle('external'));
  el('btn-go-live-external').addEventListener('click', startGoLiveExternal);
  el('btn-cancel-external').addEventListener('click', cancelGoLiveExternal);
  el('btn-regen-rtmp-key').addEventListener('click', regenerateExternalKey);
  el('btn-copy-rtmp-url').addEventListener('click', () => copyField('ext-rtmp-url'));
  el('btn-copy-rtmp-key').addEventListener('click', () => copyField('ext-rtmp-key'));
}
