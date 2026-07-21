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

// ── Reactive waveform (canvas + AnalyserNode) ────────────────────────────────
// Two mutually-exclusive taps feed the same #live-waveform canvas:
//  - a local tap on the creator's own mic, running for the whole mic-live
//    session (already-captured audio, zero extra latency);
//  - an on-air tap on the actual produced HLS stream (/hls/live/index.m3u8),
//    used when there's no local capture to visualize — the external/RTMP
//    source, and a page reload while mic-live (the browser lost its
//    getUserMedia stream on refresh). Mirrors dashboard/liveVideo.js's
//    lv-onair-preview pattern, just <audio>+AnalyserNode instead of <video>.
let waveformAnalyser = null;
let waveformRAF      = null;

// The on-air <audio> tap's AudioContext/MediaElementAudioSourceNode/AnalyserNode
// are created once, lazily, and kept alive for the rest of the page session:
// createMediaElementSource() throws InvalidStateError if called a second time
// against the same <audio> element, even from a fresh AudioContext, so only
// the hls.js instance (cheap, no such restriction) is torn down and recreated
// per broadcast.
let onAirWaveformCtx      = null;
let onAirWaveformAnalyser = null;
let onAirWaveformHls      = null;

function drawWaveform() {
  waveformRAF = requestAnimationFrame(drawWaveform);
  const canvas = el('live-waveform');
  if (!canvas || !waveformAnalyser) return;
  const ctx = canvas.getContext('2d');
  const data = new Uint8Array(waveformAnalyser.fftSize);
  waveformAnalyser.getByteTimeDomainData(data);

  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#39ff14';
  ctx.beginPath();
  const step = w / data.length;
  for (let i = 0; i < data.length; i++) {
    const y = h / 2 + (data[i] / 128 - 1) * (h / 2) * 0.9;
    const x = i * step;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function ensureWaveformLoop() {
  if (waveformRAF == null) drawWaveform();
}

function stopWaveformLoop() {
  if (waveformRAF != null) { cancelAnimationFrame(waveformRAF); waveformRAF = null; }
  const canvas = el('live-waveform');
  if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
}

function startLocalWaveform(audioCtx, source) {
  waveformAnalyser = audioCtx.createAnalyser();
  waveformAnalyser.fftSize = 1024;
  waveformAnalyser.smoothingTimeConstant = 0.75;
  source.connect(waveformAnalyser);
  ensureWaveformLoop();
}

function stopLocalWaveform() {
  waveformAnalyser = null;
  stopWaveformLoop();
}

function ensureOnAirWaveformGraph(audioEl) {
  if (onAirWaveformAnalyser) return;
  onAirWaveformCtx = new AudioContext();
  const source = onAirWaveformCtx.createMediaElementSource(audioEl);
  onAirWaveformAnalyser = onAirWaveformCtx.createAnalyser();
  onAirWaveformAnalyser.fftSize = 1024;
  onAirWaveformAnalyser.smoothingTimeConstant = 0.75;
  source.connect(onAirWaveformAnalyser);
}

// Exported so dashboard/live-external.js can drive the same canvas from the
// RTMP/OBS source, which has no local browser capture to tap before the
// encoder connects — this is the only visual feedback available for it.
export function startOnAirWaveform() {
  const audioEl = el('live-onair-audio');
  if (!audioEl) return;
  stopOnAirHls();

  const url = '/hls/live/index.m3u8';
  if (window.Hls && Hls.isSupported()) {
    onAirWaveformHls = new Hls({ lowLatencyMode: false });
    onAirWaveformHls.loadSource(url);
    onAirWaveformHls.attachMedia(audioEl);
  } else if (audioEl.canPlayType('application/vnd.apple.mpegurl')) {
    audioEl.src = url;
  }
  audioEl.muted = true; // feeds the analyser only — never audibly duplicate playback
  audioEl.play().catch(() => {});

  ensureOnAirWaveformGraph(audioEl);
  if (onAirWaveformCtx.state === 'suspended') onAirWaveformCtx.resume().catch(() => {});
  waveformAnalyser = onAirWaveformAnalyser;
  ensureWaveformLoop();
}

function stopOnAirHls() {
  if (onAirWaveformHls) { try { onAirWaveformHls.destroy(); } catch {} onAirWaveformHls = null; }
  const audioEl = el('live-onair-audio');
  if (audioEl) { audioEl.removeAttribute('src'); try { audioEl.load(); } catch {} }
}

export function stopOnAirWaveform() {
  if (waveformAnalyser === onAirWaveformAnalyser) waveformAnalyser = null;
  stopWaveformLoop();
  stopOnAirHls();
  // The AudioContext/source/analyser graph itself is NOT torn down here — it's
  // a page-session-lifetime singleton (see ensureOnAirWaveformGraph above),
  // reused by the next broadcast rather than recreated.
}

// Injected by dashboard/live-external.js via main.js (callback-injection
// pattern, avoids a circular import between the two sibling live-source
// modules) so the shared END BROADCAST button can tear down an external
// encoder's poll/timer even though this module owns that button's handler.
let _teardownExternalOnAir = () => {};

export function init(callbacks = {}) {
  if (callbacks.teardownExternalOnAir) _teardownExternalOnAir = callbacks.teardownExternalOnAir;
}

export function loadDashLive() {
  // Sync UI to current server live state on dashboard open
  api.dashboard.live.status().then(data => {
    if (data.isLive && data.source === 'mic') {
      el('live-idle').hidden  = true;
      el('live-onair').hidden = false;
      el('live-onair').dataset.source = 'mic';
      el('live-source-toggle').hidden = true;
      // The browser lost its getUserMedia stream on reload — there's no local
      // mic tap to resume, so fall back to the on-air HLS tap (same one the
      // external/RTMP source uses) to still show a reactive waveform.
      startOnAirWaveform();
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
  startLocalWaveform(liveAudioCtx, source);

  liveWorkletNode.port.onmessage = async e => {
    const f32 = e.data;
    // Convert Float32 → Int16 PCM
    const i16 = new Int16Array(f32.length);
    for (let i = 0; i < f32.length; i++) {
      i16[i] = Math.max(-1, Math.min(1, f32[i])) * 0x7FFF;
    }
    try {
      await api.dashboard.live.sendChunk(i16.buffer);
    } catch {}
  };

  // Show on-air UI
  liveStartedAt = Date.now();
  el('live-idle').hidden  = true;
  el('live-onair').hidden = false;
  el('live-onair').dataset.source = 'mic';
  el('live-source-toggle').hidden = true;
  el('live-timer').textContent = '0:00';
  liveTimerInt = setInterval(() => {
    el('live-timer').textContent = fmt(Math.floor((Date.now() - liveStartedAt) / 1000));
  }, 1000);
}

export async function stopGoLive() {
  if (liveTimerInt)    { clearInterval(liveTimerInt); liveTimerInt = null; }
  if (liveWorkletNode) { try { liveWorkletNode.disconnect(); } catch {} liveWorkletNode = null; }
  if (liveAudioCtx)    { await liveAudioCtx.close().catch(() => {}); liveAudioCtx = null; }
  if (liveMediaStream) { liveMediaStream.getTracks().forEach(t => t.stop()); liveMediaStream = null; }
  stopLocalWaveform();
  // Unconditional: covers both the external/RTMP source and the mic-source
  // reload-fallback in loadDashLive(), either of which may have started the
  // on-air HLS tap instead of (or without ever reaching) the local mic tap.
  stopOnAirWaveform();

  const wasExternal = el('live-onair').dataset.source === 'external';
  if (wasExternal) _teardownExternalOnAir();

  try { await api.dashboard.live.stop(); } catch {}

  el('live-onair').hidden = true;
  el('live-source-toggle').hidden = false;
  if (wasExternal) {
    el('live-external').hidden = false;
    el('live-external-idle').hidden = false;
    el('live-external-pending').hidden = true;
  } else {
    el('live-idle').hidden = false;
  }
  el('live-idle-msg').textContent = '';
  el('btn-go-live').disabled = false;
  el('btn-go-live-external').disabled = false;
}

export function initLiveHandlers() {
  el('btn-go-live').addEventListener('click', startGoLive);
  el('btn-end-live').addEventListener('click', stopGoLive);
}
