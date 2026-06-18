/**
 * ascii.js — Canvas renderers: audio terminal card and video ASCII art.
 *
 * Owns local state: asciiMode, asciiRafId, asciiAnalyser, asciiAudioCtx,
 *   asciiAudioSrc, asciiArtImg, asciiArtId, asciiVidOff, asciiStartTime.
 *
 * Reads currentIsVideo and stationName via injected callbacks (init()) to
 * avoid importing hls-client.js — those values are hls-client's local state.
 */

import { state, ASCII_DENSITY } from './state.js';
import { el } from './utils.js';

// ── Module-local state ────────────────────────────────────────────────────────

let asciiMode      = null;  // 'audio' | 'video'
let asciiRafId     = null;
let asciiAnalyser  = null;
let asciiAudioCtx  = null;
let asciiAudioSrc  = null;
let asciiArtImg    = null;
let asciiArtId     = null;
let asciiVidOff    = null;
let asciiStartTime = null;

// ── Injected callbacks ────────────────────────────────────────────────────────

let _isVideoMode    = () => false;
let _getStationName = () => '';

/**
 * Register callbacks that supply hls-client-owned state.
 * Called from main.js in Phase 8 after hls-client.js is initialized.
 *
 * @param {{ isVideoMode: () => boolean, getStationName: () => string }} cbs
 */
export function init({ isVideoMode, getStationName } = {}) {
  if (isVideoMode)    _isVideoMode    = isVideoMode;
  if (getStationName) _getStationName = getStationName;
}

// ── Public API ────────────────────────────────────────────────────────────────

export function asciiStart(mode) {
  if (asciiMode === mode) return;
  asciiMode = mode;
  const canvas = el('asci-canvas');
  canvas.width  = 480;
  canvas.height = 210;
  el('asci-wrap').hidden           = false;
  el('art-svg').style.display      = 'none';
  el('video-el').hidden            = true;
  // audio mode renders art-meta on the canvas; video mode keeps the overlay
  el('art-meta').style.display     = mode === 'video' ? '' : 'none';
  if (!asciiRafId) asciiRafId = requestAnimationFrame(asciiFrame);
}

export function asciiStop() {
  asciiMode      = null;
  asciiStartTime = null;
  if (asciiRafId) { cancelAnimationFrame(asciiRafId); asciiRafId = null; }
  el('asci-wrap').hidden        = true;
  el('art-svg').style.display   = '';
  el('art-meta').style.display  = '';
  const vidEl = el('video-el');
  if (vidEl) vidEl.hidden = !_isVideoMode();
}

export function asciiInitAudio() {
  if (asciiAudioSrc) return;
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    asciiAudioCtx = new AudioCtx();
    const src = asciiAudioCtx.createMediaElementSource(el('audio-el'));
    asciiAudioSrc = src;
    asciiAnalyser = asciiAudioCtx.createAnalyser();
    asciiAnalyser.fftSize = 256;
    src.connect(asciiAnalyser);
    asciiAnalyser.connect(asciiAudioCtx.destination);
  } catch { asciiAnalyser = null; }
}

export function asciiLoadArtwork(id) {
  if (!id || asciiArtId === id) return;
  asciiArtId = id; asciiArtImg = null;
  const img = new Image();
  img.onload = () => { if (asciiArtId === id) asciiArtImg = img; };
  img.src = `/api/library/${id}/artwork`;
}

// ── Internal renderers ────────────────────────────────────────────────────────

function asciiFrame() {
  asciiRafId = null;
  if (!asciiMode) return;
  const canvas = el('asci-canvas');
  const ctx = canvas.getContext('2d');
  if (asciiMode === 'audio') drawAudioCard(canvas, ctx);
  else                       drawVideoAscii(canvas, ctx);
  asciiRafId = requestAnimationFrame(asciiFrame);
}

function asciiAccent() {
  return getComputedStyle(document.documentElement).getPropertyValue('--color').trim() || '#00cc88';
}

function drawAudioCard(canvas, ctx) {
  const W = canvas.width, H = canvas.height;
  const np = state.nowPlaying;
  const accent = asciiAccent();

  if (!asciiStartTime) asciiStartTime = performance.now();
  const elapsed = performance.now() - asciiStartTime;

  const TICKER_H = H - 42;
  const ART_W = 130, ART_H = 130;
  const ART_Y = Math.round((TICKER_H - ART_H) / 2);

  // Background
  ctx.fillStyle = '#050505';
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, W, TICKER_H);
  ctx.clip();

  // Layer 1: station name watermark (20px/sec)
  const stn = (_getStationName() || 'PAPERWEIGHT').toUpperCase() + '  ◆  ';
  ctx.font = 'bold 11px "Courier New",monospace';
  ctx.textBaseline = 'middle';
  const patW = ctx.measureText(stn).width;
  const bg1X = -(elapsed * 20 / 1000 % patW);
  ctx.globalAlpha = 0.07;
  ctx.fillStyle = accent;
  for (let x = bg1X; x < W + patW; x += patW) {
    ctx.fillText(stn, x, TICKER_H / 2);
  }
  ctx.globalAlpha = 1;

  // Layer 2: cover art block (50px/sec)
  const artPeriod = ART_W + W + 40;
  const artX = Math.round(W - (elapsed * 50 / 1000 % artPeriod));
  if (asciiArtImg) {
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(asciiArtImg, artX, ART_Y, ART_W, ART_H);
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = '#000';
    const DOT = 4;
    for (let dy = 0; dy < ART_H; dy += DOT) {
      for (let dx = 0; dx < ART_W; dx += DOT) {
        ctx.beginPath();
        ctx.arc(artX + dx + DOT/2, ART_Y + dy + DOT/2, DOT * 0.35, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  } else {
    ctx.fillStyle = accent + '18';
    ctx.fillRect(artX, ART_Y, ART_W, ART_H);
    ctx.font = `bold 56px "Courier New",monospace`;
    ctx.fillStyle = accent + '55';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(((np?.title || _getStationName() || '?')[0] || '?').toUpperCase(), artX + ART_W / 2, ART_Y + ART_H / 2);
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  }

  // Layer 3: track info text (62.5px/sec)
  if (np) {
    ctx.textBaseline = 'top';
    const title    = np.title    || '---';
    const artist   = np.artist   || '';
    const category = np.category || '';
    ctx.font = `bold 22px "Courier New",monospace`;
    const tw = ctx.measureText(title).width;
    ctx.font = `11px "Courier New",monospace`;
    const aw = ctx.measureText(artist).width;
    ctx.font = `10px "Courier New",monospace`;
    const cw = ctx.measureText(category).width;
    const INFO_W    = Math.max(tw, aw, cw);
    const infoPeriod = INFO_W + W + 40;
    const infoX = Math.round(W - (elapsed * 62.5 / 1000 % infoPeriod));
    const midY  = Math.round(TICKER_H / 2);

    ctx.font = `bold 22px "Courier New",monospace`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(title, infoX, midY - 24);

    ctx.font = `11px "Courier New",monospace`;
    ctx.fillStyle = 'rgba(255,255,255,.5)';
    ctx.fillText(artist, infoX, midY + 4);

    ctx.font = `10px "Courier New",monospace`;
    ctx.fillStyle = accent + '99';
    ctx.fillText(category, infoX, midY + 21);
  }

  // Edge vignette
  const vigW = 44;
  const leftG = ctx.createLinearGradient(0, 0, vigW, 0);
  leftG.addColorStop(0, '#050505');
  leftG.addColorStop(1, 'transparent');
  ctx.fillStyle = leftG;
  ctx.fillRect(0, 0, vigW, TICKER_H);

  const rightG = ctx.createLinearGradient(W - vigW, 0, W, 0);
  rightG.addColorStop(0, 'transparent');
  rightG.addColorStop(1, '#050505');
  ctx.fillStyle = rightG;
  ctx.fillRect(W - vigW, 0, vigW, TICKER_H);

  ctx.restore();

  // Waveform strip (fixed position at bottom)
  drawWaveBars(ctx, 8, H - 42, W - 16, 32, accent);

  // Bottom rule
  ctx.fillStyle = accent + '22';
  ctx.fillRect(8, H - 8, W - 16, 1);
}

function drawWaveBars(ctx, x, y, w, h, accent) {
  const COUNT = 52, barW = w / COUNT;
  if (asciiAnalyser) {
    const data = new Uint8Array(asciiAnalyser.frequencyBinCount);
    asciiAnalyser.getByteFrequencyData(data);
    for (let i = 0; i < COUNT; i++) {
      const bin = Math.floor(i / COUNT * asciiAnalyser.frequencyBinCount * 0.65);
      const amp = data[bin] / 255;
      const bh  = Math.max(2, Math.round(amp * h));
      ctx.fillStyle = accent + Math.round((0.35 + amp * 0.65) * 255).toString(16).padStart(2, '0');
      ctx.fillRect(x + i * barW, y + h - bh, barW - 1, bh);
    }
  } else {
    ctx.fillStyle = accent + '22';
    ctx.fillRect(x, y + h - 2, w, 2);
  }
}

function drawVideoAscii(canvas, ctx) {
  const vidEl = el('video-el');
  if (!vidEl || vidEl.readyState < 2) return;
  const W = canvas.width, H = canvas.height;
  const COLS = 60, ROWS = 26;
  const cw = W / COLS, ch = H / ROWS;
  if (!asciiVidOff) {
    asciiVidOff = document.createElement('canvas');
    asciiVidOff.width = COLS; asciiVidOff.height = ROWS;
  }
  const off = asciiVidOff.getContext('2d', { willReadFrequently: true });
  off.drawImage(vidEl, 0, 0, COLS, ROWS);
  const px = off.getImageData(0, 0, COLS, ROWS).data;
  ctx.fillStyle = '#050505';
  ctx.fillRect(0, 0, W, H);
  ctx.font = `bold ${Math.ceil(ch)}px "Courier New",monospace`;
  ctx.textBaseline = 'top';
  let prev = '';
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const i  = (r * COLS + c) * 4;
      const R  = px[i], G = px[i+1], B = px[i+2];
      const br = (0.299*R + 0.587*G + 0.114*B) / 255;
      const ch2 = ASCII_DENSITY[Math.floor(br * (ASCII_DENSITY.length - 1))];
      const col = `rgb(${R},${G},${B})`;
      if (col !== prev) { ctx.fillStyle = col; prev = col; }
      ctx.fillText(ch2, c * cw, r * ch);
    }
  }
}

export function drawAsciiArt(ctx, img, x, y, w, h) {
  const C = 22, R = 11;
  const tmp = document.createElement('canvas');
  tmp.width = C; tmp.height = R;
  const tc = tmp.getContext('2d', { willReadFrequently: true });
  tc.drawImage(img, 0, 0, C, R);
  const px   = tc.getImageData(0, 0, C, R).data;
  const SIMP = ' .:-=+*#%@';
  const cw = w / C, ch = h / R;
  ctx.font = `bold ${Math.ceil(ch)}px "Courier New",monospace`;
  ctx.textBaseline = 'top';
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      const i  = (r * C + c) * 4;
      const br = (0.299*px[i] + 0.587*px[i+1] + 0.114*px[i+2]) / 255;
      ctx.fillStyle = `rgb(${px[i]},${px[i+1]},${px[i+2]})`;
      ctx.fillText(SIMP[Math.floor(br * (SIMP.length - 1))], x + c * cw, y + r * ch);
    }
  }
}
