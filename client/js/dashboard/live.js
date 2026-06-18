/**
 * dashboard/live.js — Live broadcast via WebAudio + AudioWorklet.
 */

import * as api from '../api.js';
import { el, fmt } from '../utils.js';

// ── Module-local state ─────────────────────────────────────────────────────────
let liveAudioCtx    = null;
let liveWorkletNode = null;
let liveMediaStream = null;
let liveTimerInt    = null;
let liveStartedAt   = 0;

export function init() {}

export function loadDashLive() {
  // Sync UI to current server live state on dashboard open
  api.dashboard.live.status().then(data => {
    if (data.isLive) {
      el('live-idle').hidden  = true;
      el('live-onair').hidden = false;
    }
  }).catch(() => {});
}

export async function startGoLive() {
  const msgEl = el('live-idle-msg');
  msgEl.textContent = 'Requesting microphone…';
  el('btn-go-live').disabled = true;

  try {
    liveMediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { sampleRate: 44100, channelCount: 1, echoCancellation: false, noiseSuppression: false },
      video: false,
    });
  } catch (err) {
    msgEl.textContent = `Mic access denied: ${err.message}`;
    el('btn-go-live').disabled = false;
    return;
  }

  // Tell server to start live HLS output
  try {
    const { res, data } = await api.dashboard.live.start();
    if (!res.ok) {
      msgEl.textContent = data.error || 'Could not start live session';
      liveMediaStream.getTracks().forEach(t => t.stop());
      liveMediaStream = null;
      el('btn-go-live').disabled = false;
      return;
    }
  } catch {
    msgEl.textContent = 'Server error — try again';
    liveMediaStream.getTracks().forEach(t => t.stop());
    liveMediaStream = null;
    el('btn-go-live').disabled = false;
    return;
  }

  // Set up AudioWorklet using static file instead of blob URL
  liveAudioCtx = new AudioContext({ sampleRate: 44100 });

  try {
    await liveAudioCtx.audioWorklet.addModule('/js/worklet-processor.js');
  } catch (err) {
    msgEl.textContent = `AudioWorklet error: ${err.message}`;
    await stopGoLive();
    return;
  }

  const source = liveAudioCtx.createMediaStreamSource(liveMediaStream);
  liveWorkletNode = new AudioWorkletNode(liveAudioCtx, 'pw-pcm');
  source.connect(liveWorkletNode);

  liveWorkletNode.port.onmessage = async e => {
    const f32 = e.data;
    // Convert Float32 → Int16 PCM
    const i16 = new Int16Array(f32.length);
    for (let i = 0; i < f32.length; i++) {
      i16[i] = Math.max(-1, Math.min(1, f32[i])) * 0x7FFF;
    }
    updateMicMeter(f32);
    try {
      await api.dashboard.live.sendChunk(i16.buffer);
    } catch {}
  };

  // Show on-air UI
  liveStartedAt = Date.now();
  el('live-idle').hidden  = true;
  el('live-onair').hidden = false;
  el('live-timer').textContent = '0:00';
  liveTimerInt = setInterval(() => {
    el('live-timer').textContent = fmt(Math.floor((Date.now() - liveStartedAt) / 1000));
  }, 1000);
}

function updateMicMeter(f32) {
  const bars = 14;
  let sum = 0;
  for (const s of f32) sum += s * s;
  const rms   = Math.sqrt(sum / f32.length);
  const level = Math.min(1, rms * 10);
  const meter = el('live-meter');
  meter.innerHTML = Array.from({ length: bars }, (_, i) => {
    const threshold = (i + 1) / bars;
    const active = level >= threshold;
    const color   = i < bars * 0.65 ? '#39ff14' : i < bars * 0.85 ? '#ffa030' : '#ff4444';
    const height  = 35 + i * 4.5;
    return `<div class="live-meter-bar" style="background:${active ? color : 'rgba(255,255,255,.07)'};height:${height}%;"></div>`;
  }).join('');
}

export async function stopGoLive() {
  if (liveTimerInt)    { clearInterval(liveTimerInt); liveTimerInt = null; }
  if (liveWorkletNode) { try { liveWorkletNode.disconnect(); } catch {} liveWorkletNode = null; }
  if (liveAudioCtx)    { await liveAudioCtx.close().catch(() => {}); liveAudioCtx = null; }
  if (liveMediaStream) { liveMediaStream.getTracks().forEach(t => t.stop()); liveMediaStream = null; }

  try { await api.dashboard.live.stop(); } catch {}

  el('live-onair').hidden  = true;
  el('live-idle').hidden   = false;
  el('live-idle-msg').textContent = '';
  el('btn-go-live').disabled = false;
}

export function initLiveHandlers() {
  el('btn-go-live').addEventListener('click', startGoLive);
  el('btn-end-live').addEventListener('click', stopGoLive);
}
