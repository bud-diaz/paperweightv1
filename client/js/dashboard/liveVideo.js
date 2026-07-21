/**
 * dashboard/liveVideo.js — Live video (paid-tier) broadcast via browser
 * capture or RTMP/OBS.
 *
 * Two ingest sources feed the same on-air panel and status poll:
 *  - Browser: getUserMedia + MediaRecorder capture the creator's camera/mic
 *    in-browser and POST WebM chunks to /api/dashboard/live-video/chunk,
 *    mirroring dashboard/live.js's mic-capture pattern for audio. Works on
 *    both web and desktop — no new port, chunks ride the same authenticated
 *    dashboard session.
 *  - RTMP (OBS, mirrors dashboard/live-external.js): the server owns the
 *    whole capture pipeline, FFmpeg listens for a single inbound RTMP
 *    connection, and the dashboard polls /api/dashboard/live-video/status to
 *    learn whether it's idle, waiting for an encoder ("pending"), or on air.
 *    Desktop-only — the RTMP listener binds to the local machine/LAN.
 *
 * The minimum-tier and notify settings stay usable on the hosted web
 * platform regardless of source, since they're just creator preferences.
 */

import * as api from '../api.js';
import { el, fmt } from '../utils.js';
import { isDesktopPlatform } from './index.js';

const POLL_MS = 2000;

let pollInt = null;
let timerInt = null;
let startedAtMs = 0;
let lastState = 'idle';

// Browser-capture state
let lvMediaStream = null;
let lvRecorder = null;
let lvOnAirHls = null;

// Which idle panel the desktop-only toggle currently shows ('browser' is the
// default and the only option on web, since the toggle itself is hidden there).
let toggleSource = 'browser';

export function init() {}

function renderRtmpFields(rtmp) {
  if (!rtmp) return;
  el('lv-rtmp-url').textContent = rtmp.url || '';
  el('lv-rtmp-key').textContent = rtmp.streamKey || '';
}

function setLvSourceToggle(source) {
  toggleSource = source;
  el('btn-lv-source-browser').classList.toggle('active', source === 'browser');
  el('btn-lv-source-rtmp').classList.toggle('active', source === 'rtmp');
  el('live-video-browser-idle').hidden = source !== 'browser';
  el('live-video-idle').hidden = source !== 'rtmp';
}

function stopOnAirPreview() {
  const videoEl = el('lv-onair-preview');
  if (lvOnAirHls) { try { lvOnAirHls.destroy(); } catch {} lvOnAirHls = null; }
  videoEl.removeAttribute('src');
  try { videoEl.load(); } catch {}
}

function startOnAirPreview() {
  const videoEl = el('lv-onair-preview');
  const url = '/hls/live-video/index.m3u8';
  stopOnAirPreview();
  if (window.Hls && Hls.isSupported()) {
    lvOnAirHls = new Hls({ lowLatencyMode: false });
    lvOnAirHls.loadSource(url);
    lvOnAirHls.attachMedia(videoEl);
  } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
    videoEl.src = url;
  }
}

function showIdlePanel() {
  el('live-video-onair').hidden = true;
  el('live-video-source-toggle').hidden = false;
  setLvSourceToggle(toggleSource);
  el('live-video-pending').hidden = true;
  el('btn-go-live-video').disabled = false;
  el('btn-go-live-video-browser').disabled = false;
  stopOnAirPreview();
}

function showPendingPanel(rtmp) {
  el('live-video-onair').hidden = true;
  el('live-video-source-toggle').hidden = true;
  el('live-video-browser-idle').hidden = true;
  el('live-video-idle').hidden = true;
  el('live-video-pending').hidden = false;
  renderRtmpFields(rtmp);
  el('live-video-status').textContent = 'Waiting for OBS to connect…';
}

function stopOnAirTimer() {
  if (timerInt) { clearInterval(timerInt); timerInt = null; }
}

function showOnAir(startedAt, source) {
  el('live-video-source-toggle').hidden = true;
  el('live-video-browser-idle').hidden = true;
  el('live-video-idle').hidden = true;
  el('live-video-pending').hidden = true;
  el('live-video-onair').hidden = false;
  if (source) el('live-video-onair').dataset.source = source;

  startedAtMs = startedAt ? new Date(startedAt).getTime() : Date.now();
  stopOnAirTimer();
  el('live-video-timer').textContent = fmt(Math.floor((Date.now() - startedAtMs) / 1000));
  timerInt = setInterval(() => {
    el('live-video-timer').textContent = fmt(Math.floor((Date.now() - startedAtMs) / 1000));
  }, 1000);
  startOnAirPreview();
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
    if (lastState !== 'live') showOnAir(data.startedAt, data.source);
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
  api.dashboard.liveVideo.status().then(data => {
    renderRtmpFields(data.rtmp);
    lastState = data.state;
    if (data.state === 'live') {
      if (data.source === 'rtmp') setLvSourceToggle('rtmp');
      showOnAir(data.startedAt, data.source);
      startPolling();
    } else if (data.state === 'pending') {
      setLvSourceToggle('rtmp');
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

// ── Browser capture (camera + mic) ──────────────────────────────────────────

function pickSupportedMimeType() {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  return candidates.find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || null;
}

function stopBrowserCapture() {
  if (lvRecorder && lvRecorder.state !== 'inactive') { try { lvRecorder.stop(); } catch {} }
  lvRecorder = null;
  if (lvMediaStream) { lvMediaStream.getTracks().forEach(t => t.stop()); lvMediaStream = null; }
  const preview = el('lv-preview');
  if (preview) preview.srcObject = null;
}

async function startGoLiveVideoBrowser() {
  const msgEl = el('live-video-browser-msg');
  msgEl.textContent = 'Requesting camera and microphone…';
  el('btn-go-live-video-browser').disabled = true;

  try {
    lvMediaStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
      audio: { echoCancellation: true, noiseSuppression: true },
    });
  } catch (err) {
    msgEl.textContent = `Camera/mic access denied: ${err.message}`;
    el('btn-go-live-video-browser').disabled = false;
    return;
  }

  el('lv-preview').srcObject = lvMediaStream;

  const mimeType = pickSupportedMimeType();
  if (!mimeType) {
    msgEl.textContent = 'Your browser cannot record video in a supported format.';
    stopBrowserCapture();
    el('btn-go-live-video-browser').disabled = false;
    return;
  }

  try {
    const { res, data } = await api.dashboard.liveVideo.startBrowser();
    if (!res.ok) {
      msgEl.textContent = data.error || 'Could not start live video broadcast';
      stopBrowserCapture();
      el('btn-go-live-video-browser').disabled = false;
      return;
    }
  } catch {
    msgEl.textContent = 'Server error — try again';
    stopBrowserCapture();
    el('btn-go-live-video-browser').disabled = false;
    return;
  }

  lvRecorder = new MediaRecorder(lvMediaStream, {
    mimeType,
    videoBitsPerSecond: 2_000_000,
    audioBitsPerSecond: 128_000,
  });
  lvRecorder.ondataavailable = e => {
    if (!e.data || !e.data.size) return;
    api.dashboard.liveVideo.sendChunk(e.data).catch(() => {});
  };
  lvRecorder.onerror = () => {
    msgEl.textContent = 'Recording error — ending broadcast';
    endLiveVideo();
  };
  lvMediaStream.getVideoTracks()[0].onended = () => endLiveVideo();
  lvRecorder.start(1000);

  lastState = 'live';
  showOnAir(new Date().toISOString(), 'browser');
  startPolling();
}

async function endLiveVideo() {
  stopPolling();
  stopOnAirTimer();
  if (el('live-video-onair').dataset.source === 'browser') stopBrowserCapture();
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
  el('btn-lv-source-browser').addEventListener('click', () => setLvSourceToggle('browser'));
  el('btn-lv-source-rtmp').addEventListener('click', () => setLvSourceToggle('rtmp'));
  el('btn-go-live-video-browser').addEventListener('click', startGoLiveVideoBrowser);
  el('btn-go-live-video').addEventListener('click', startGoLiveVideo);
  el('btn-end-live-video').addEventListener('click', endLiveVideo);
  el('btn-cancel-live-video').addEventListener('click', endLiveVideo);
  el('btn-regen-lv-rtmp-key').addEventListener('click', regenerateLiveVideoKey);
  el('btn-copy-lv-rtmp-url').addEventListener('click', () => copyField('lv-rtmp-url'));
  el('btn-copy-lv-rtmp-key').addEventListener('click', () => copyField('lv-rtmp-key'));
  el('live-video-min-tier').addEventListener('change', saveLiveVideoSettings);
  el('live-video-notify-toggle').addEventListener('change', saveLiveVideoSettings);
}
