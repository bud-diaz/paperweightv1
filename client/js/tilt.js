/**
 * tilt.js — Gentle 3D tilt for the PLAY viewport (#art-wrap) and waveform/
 * transport (#spine) cards. Modeled on the landing-page hero tilt
 * (landing/index.html) but resting flat (0°).
 *
 * Desktop: follows the mouse across the window.
 * Mobile:  opt-in via the #motion-toggle switch (device orientation; iOS needs
 *          a permission prompt fired from the tap, hence the explicit toggle).
 * The Posts ticker is intentionally excluded — it stays static.
 *
 * Honors `prefers-reduced-motion: reduce` (no tilt at all).
 */

import { el } from './utils.js';

const PERSPECTIVE = 1200;
const TILT_MAX    = 10;     // landing hero uses 12
const SMOOTH      = 0.10;
const MOTION_KEY  = 'pw_motion_tilt';

let targets = [];
let curRx = 0, curRy = 0, tgtRx = 0, tgtRy = 0;
let rafId = null;
let baseBeta = null, baseGamma = null;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function applyLoop() {
  curRx += (tgtRx - curRx) * SMOOTH;
  curRy += (tgtRy - curRy) * SMOOTH;
  const tf = `perspective(${PERSPECTIVE}px) rotateX(${curRx.toFixed(2)}deg) rotateY(${curRy.toFixed(2)}deg)`;
  for (const t of targets) if (t) t.style.transform = tf;
  rafId = requestAnimationFrame(applyLoop);
}

function startLoop() { if (rafId === null) rafId = requestAnimationFrame(applyLoop); }

function stopLoop() {
  if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
  curRx = curRy = tgtRx = tgtRy = 0;
  for (const t of targets) if (t) t.style.transform = '';
}

// ── Desktop: mouse-driven ────────────────────────────────────────────────────
function onMouseMove(e) {
  const nx = (e.clientX - window.innerWidth  / 2) / (window.innerWidth  / 2);
  const ny = (e.clientY - window.innerHeight / 2) / (window.innerHeight / 2);
  tgtRy =  nx * TILT_MAX;
  tgtRx = -ny * TILT_MAX;
}

// ── Mobile: device-orientation-driven (opt-in) ───────────────────────────────
function onOrient(e) {
  if (e.beta == null || e.gamma == null) return;
  if (baseBeta === null) { baseBeta = e.beta; baseGamma = e.gamma; }
  const db = clamp(e.beta  - baseBeta,  -30, 30);
  const dg = clamp(e.gamma - baseGamma, -30, 30);
  tgtRx = -(db / 30) * TILT_MAX;
  tgtRy =  (dg / 30) * TILT_MAX;
}

async function enableMotion() {
  try {
    const DOE = window.DeviceOrientationEvent;
    if (DOE && typeof DOE.requestPermission === 'function') {
      const res = await DOE.requestPermission(); // iOS 13+: must be user-gesture-driven
      if (res !== 'granted') return false;
    } else if (!DOE) {
      return false;
    }
    baseBeta = baseGamma = null;
    window.addEventListener('deviceorientation', onOrient);
    startLoop();
    localStorage.setItem(MOTION_KEY, '1');
    return true;
  } catch { return false; }
}

function disableMotion() {
  window.removeEventListener('deviceorientation', onOrient);
  stopLoop();
  localStorage.removeItem(MOTION_KEY);
}

export function initTilt() {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

  targets = [el('art-wrap'), el('spine')].filter(Boolean);
  if (!targets.length) return;

  const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  const canHover = window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;

  if (canHover && !isTouch) {
    // Desktop: always-on mouse tilt.
    window.addEventListener('mousemove', onMouseMove);
    startLoop();
    return;
  }

  // Touch device: gate behind the explicit #motion-toggle.
  const input = el('motion-toggle-input');
  if (!input) return;
  input.addEventListener('change', async () => {
    if (input.checked) {
      const ok = await enableMotion();
      input.checked = ok;
    } else {
      disableMotion();
    }
  });

  // Re-enable from a prior session where permission isn't gated (e.g. Android).
  if (localStorage.getItem(MOTION_KEY) === '1') {
    const DOE = window.DeviceOrientationEvent;
    if (!(DOE && typeof DOE.requestPermission === 'function')) {
      enableMotion().then(ok => { input.checked = ok; });
    }
  }
}
