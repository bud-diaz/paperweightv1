/**
 * player.js — Core player: render loop, VOD selection, seek, drawers.
 *
 * DOM nodes touched by render() and setColor() — full inventory:
 *   document.documentElement   (CSS var --color)
 *   #ambient                   (background radial-gradient)
 *   #bottom-accent             (background linear-gradient)
 *   #on-air-dot                (background, boxShadow)
 *   #on-air-text               (color)
 *   #art-box                   (border, background)
 *   .pulse-ring (all)          (borderColor)
 *   #lib-btn                   (color, background, border)
 *   #queue-btn                 (color, background, border)
 *   #share-tab-label           (color, textContent)
 *   #auth-badge                (class: visible)
 *   #type-badge                (background, innerHTML/textContent)
 *   #real-video-toggle-wrap    (hidden)
 *   #back-live-btn             (display)
 *   #track-title               (textContent)
 *   #track-creator             (textContent)
 *   #track-station             (textContent)
 *   #on-air-badge              (display)
 *   #quota-badge               (display, textContent)
 *   #fullscreen-btn            (display)
 *   #pr1                       (display)
 *   #pr2                       (display)
 *   #play-icon                 (display)
 *   #pause-icon                (display)
 *   #play-btn                  (background, boxShadow)
 *   #skip-prev                 (class: hidden)
 *   #skip-next                 (class: hidden)
 *   #waveform                  (innerHTML, class: disabled — via renderWaveform)
 *   #time-elapsed              (textContent, color, opacity)
 *   #time-remain               (textContent)
 *   #lib-drawer                (maxHeight — via setDrawer)
 *   #queue-drawer              (maxHeight — via setDrawer)
 *   #share-drawer              (maxHeight — via setDrawer)
 *   #share-tab                 (class: locked)
 *   #account-tab-label         (textContent)
 *   #share-chevron             (transform)
 *
 * DOM nodes touched by renderArtBack():
 *   #art-back                  (background, borderColor)
 *   #ab-title                  (textContent)
 *   #ab-artist                 (textContent)
 *   #ab-rows                   (innerHTML)
 *   #ab-duration-cat           (textContent)
 *
 * DOM nodes touched by resetArtFlip():
 *   #art-flip                  (class: flipped)
 *
 * DOM nodes touched by seekWaveform():
 *   #waveform                  (getBoundingClientRect)
 *   #time-elapsed              (textContent)
 *   #time-remain               (textContent)
 *
 * Event listeners owned by player (to be wired in main.js, Phase 8):
 *   #play-btn        click → togglePlay
 *   #skip-prev       click → skipTrack(-1)
 *   #skip-next       click → skipTrack(1)
 *   #back-live-btn   click → goLive
 *   #lib-btn         click → toggleDrawer('lib')
 *   #queue-btn       click → toggleDrawer('queue')
 *   #share-area      click → toggleShare
 *   #account-area    click → open share + scroll to auth-toggle
 *   #waveform        click → seekWaveform
 *   #art-flip        click → flip art card / renderArtBack
 *   #fullscreen-btn  click → toggleFullscreen
 *   .view-tab (all)  click → switch PLAY/STUDIO view
 *   #pw-wordmark-text mousedown/touchstart/up/leave → long-press enterDashboard,
 *                     short press → station-directory search field (main.js)
 */

import {
  state, PREVIEW_SECS, LIBRARY, authState,
} from './state.js';
import { el, fmt, esc, generateWaveform, setDrawer, showToast } from './utils.js';
import * as api from './api.js';
import {
  setupHls, activeMediaEl, getHls, isVideoMode, getStationName,
  startPingInterval, stopPingInterval, isPingActive,
} from './hls-client.js';

// ── Module-local state (player owns these exclusively) ────────────────────────────

let previewMedia   = null;  // Audio() for audio tracks, or #preview-video-el for video tracks
let previewTimer   = null;
let previewTickInt = null;
let onDemandMedia  = null;  // Audio() for audio tracks, or #preview-video-el for video tracks
let revertTimer    = null;
let nextUpTrack    = null;
let quota          = null;  // on-demand play quota status for free/anon listeners

let artFlipped      = false;
let artBackCache    = {};
let artLastTrackKey = null;

// ── Injected callbacks for ASCII module (Phase 5) and modal (Phase 6) ────────────
// Defaults are no-ops; registered by their owning modules in Phase 8.

let _asciiInitAudio   = () => {};
let _openModal        = () => {};
let _setModalTab      = (tab) => {};
let _checkVaultGate   = async () => {};
let _buildLibrary     = () => {};
let _loadQueue        = () => {};
let _takeNextQueueTrack = () => null;

/**
 * Register cross-module callbacks to avoid circular imports.
 * Called during Phase 8 wiring in main.js.
 */
export function registerCallbacks({
  asciiInitAudio,
  openModal,
  setModalTab,
  checkVaultGate,
  buildLibrary,
  loadQueue,
  takeNextQueueTrack,
} = {}) {
  if (asciiInitAudio)  _asciiInitAudio  = asciiInitAudio;
  if (openModal)       _openModal       = openModal;
  if (setModalTab)     _setModalTab     = setModalTab;
  if (checkVaultGate)  _checkVaultGate  = checkVaultGate;
  if (buildLibrary)    _buildLibrary    = buildLibrary;
  if (loadQueue)       _loadQueue       = loadQueue;
  if (takeNextQueueTrack) _takeNextQueueTrack = takeNextQueueTrack;
}

// ── Computed helpers ──────────────────────────────────────────────────────────────

export function activeTrack() {
  if (state.track) return state.track;
  const np = state.nowPlaying;
  const videoMode = isVideoMode();
  return {
    id:       0,
    type:     videoMode ? 'video' : 'audio',
    title:    np ? (np.title || 'On Air') : (state.playing ? 'On Air' : 'Off Air'),
    creator:  np?.artist || '',
    isLive:   true,
    color:    '#00F5D4',
    waveform: generateWaveform(0),
  };
}

function duration() { return state.track ? (state.track.duration || 0) : 0; }

function isPaidTier() {
  return authState.loggedIn && authState.tier !== 'free';
}

export async function loadQuota() {
  if (isPaidTier()) { quota = null; return; }
  try { quota = await api.library.streamQuota(); }
  catch { quota = null; }
}

function isPlayableTrack(t) {
  if (!t) return false;
  if (t.isExternal) return false;
  if (t.visibility === 'public') return true;
  if (t.visibility === 'supporters_only') return t.unlocked === true || isPaidTier();
  if (t.visibility === 'vault') return t.unlocked === true;
  return true;
}

// ── Art card ──────────────────────────────────────────────────────────────────────

export function resetArtFlip() {
  artFlipped = false;
  el('art-flip').classList.remove('flipped');
}

export async function renderArtBack() {
  const t = activeTrack();
  el('art-back').style.background  = `linear-gradient(135deg, ${t.color}1A 0%, #0a0a0a 60%)`;
  el('art-back').style.borderColor = `${t.color}22`;
  el('ab-title').textContent  = t.title;
  el('ab-artist').textContent = t.creator ? t.creator.toUpperCase() : '';

  let album = '', producer = '', credits = '', bpm = '';
  if (state.track?.id) {
    if (!artBackCache[state.track.id]) {
      try {
        const data = await api.library.track(state.track.id);
        if (data) artBackCache[state.track.id] = data;
      } catch {}
    }
    const extra = artBackCache[state.track.id] || {};
    album    = extra.album    || '';
    producer = extra.producer || '';
    credits  = extra.credits  || '';
    bpm      = extra.bpm      ? String(Math.round(extra.bpm)) : '';
  }

  const rows = [];
  if (album)    rows.push({ label: 'ALBUM', val: album });
  if (producer) rows.push({ label: 'PROD',  val: producer });
  if (credits)  rows.push({ label: 'FEAT',  val: credits });
  if (bpm)      rows.push({ label: 'BPM',   val: `${bpm} BPM` });

  el('ab-rows').innerHTML = rows.map(r =>
    `<div class="ab-row"><strong>${esc(r.label)}</strong>${esc(r.val)}</div>`
  ).join('');

  const dur      = state.track?.duration ? fmt(state.track.duration) : '';
  const typeLabel = t.type === 'video' ? '● VIDEO' : '◉ AUDIO';
  el('ab-duration-cat').textContent = [dur, typeLabel].filter(Boolean).join('  ·  ');
}

// ── Color / theme ─────────────────────────────────────────────────────────────────

function setColor(c) {
  document.documentElement.style.setProperty('--color', c);
  el('ambient').style.background =
    `radial-gradient(circle, ${c}12 0%, transparent 70%)`;
  el('bottom-accent').style.background =
    `linear-gradient(to right, transparent, ${c}, transparent)`;
  el('on-air-dot').style.background = c;
  el('on-air-dot').style.boxShadow  = `0 0 6px ${c}`;
  el('on-air-text').style.color     = c;
  el('art-box').style.border     = `1px solid ${c}22`;
  el('art-box').style.background = `linear-gradient(135deg, ${c}18 0%, #0a0a0a 60%)`;
  document.querySelectorAll('.pulse-ring').forEach(r => r.style.borderColor = c);
  ['lib-btn', 'queue-btn'].forEach(id => {
    const btn    = el(id);
    const active = (id === 'lib-btn' && state.showLib) || (id === 'queue-btn' && state.showQueue);
    btn.style.color      = active ? c : 'rgba(255,255,255,.35)';
    btn.style.background = active ? `${c}22` : 'none';
    btn.style.border     = active ? `1px solid ${c}44` : '1px solid transparent';
  });
  el('share-tab-label').style.color =
    state.showShare && state.sharePanel === 'share' ? c : 'rgba(255,255,255,.25)';
  el('account-tab-label').style.color =
    state.showShare && state.sharePanel === 'account' ? c : 'rgba(255,255,255,.25)';
  el('auth-badge').classList.toggle('visible', authState.loggedIn);
}

// ── Waveform ──────────────────────────────────────────────────────────────────────

export function renderWaveform() {
  const t    = activeTrack();
  const data = t.waveform || generateWaveform(0);
  const wf   = el('waveform');
  wf.innerHTML = '';
  data.forEach((h, i) => {
    const pct    = i / data.length;
    const played = state.track && pct < state.progress;
    const cursor = state.track && Math.abs(pct - state.progress) < 0.015;
    const bar    = document.createElement('div');
    bar.className = 'wbar';
    bar.style.height     = `${Math.max(4, h * 48)}px`;
    bar.style.background = cursor ? '#fff' : played ? t.color : 'rgba(255,255,255,.13)';
    if (played) bar.style.boxShadow = `0 0 5px ${t.color}77`;
    wf.appendChild(bar);
  });
}

// ── Main render ───────────────────────────────────────────────────────────────────

export function render() {
  const t = activeTrack();
  const trackKey = state.track?.id ?? 'live';
  if (trackKey !== artLastTrackKey) { artLastTrackKey = trackKey; resetArtFlip(); }
  setColor(t.color);

  // type badge
  const badge = el('type-badge');
  badge.style.background = t.color;
  if (!state.track) {
    badge.innerHTML = `<span class="live-dot-badge"></span>LIVE`;
  } else if (state.isPreview) {
    badge.textContent = '◈ PREVIEW';
  } else {
    badge.textContent = t.type === 'video' ? '● VIDEO' : '◉ AUDIO';
  }

  // real-video toggle — only relevant for the live video stream, never previews
  const rvWrap = el('real-video-toggle-wrap');
  if (rvWrap) rvWrap.hidden = state.isPreview || t.type !== 'video';

  // fullscreen button — only when a video surface is actually on screen
  el('fullscreen-btn').style.display = t.type === 'video' ? 'flex' : 'none';

  // back-live btn
  el('back-live-btn').style.display = state.track ? 'inline-block' : 'none';

  // titles
  el('track-title').textContent   = t.title;
  el('track-creator').textContent = t.creator ? t.creator.toUpperCase() : '';
  el('track-station').textContent = getStationName() ? getStationName().toUpperCase() : '';

  // on-air badge
  el('on-air-badge').style.display = !state.track ? 'flex' : 'none';

  // on-demand quota badge (free tier, live view only)
  const quotaBadge = el('quota-badge');
  const showQuota = !state.track && !isPaidTier() && quota?.limit;
  quotaBadge.style.display = showQuota ? 'flex' : 'none';
  if (showQuota) {
    quotaBadge.textContent = quota.remaining > 0
      ? `${quota.remaining} ON-DEMAND PLAY${quota.remaining === 1 ? '' : 'S'} LEFT`
      : `0 LEFT — RESETS IN ${Math.max(1, Math.ceil((quota.resetSec || 3600) / 60))}M`;
  }

  // pulse rings
  el('pr1').style.display = state.playing ? 'block' : 'none';
  el('pr2').style.display = state.playing ? 'block' : 'none';

  // play/pause icons
  el('play-icon').style.display  = state.playing ? 'none'  : 'block';
  el('pause-icon').style.display = state.playing ? 'block' : 'none';

  // play button color
  const pb = el('play-btn');
  pb.style.background = `conic-gradient(from 180deg, ${t.color}, ${t.color}99, ${t.color})`;
  pb.style.boxShadow  = `0 0 24px ${t.color}66, 0 4px 16px rgba(0,0,0,.5)`;

  // skip buttons — only when a VOD track is selected
  el('skip-prev').classList.toggle('hidden', !state.track);
  el('skip-next').classList.toggle('hidden', !state.track);

  // waveform
  renderWaveform();

  // time row
  const elapsed = el('time-elapsed');
  const remain  = el('time-remain');
  if (!state.track) {
    elapsed.textContent  = '● LIVE';
    elapsed.style.color  = t.color;
    elapsed.style.opacity = '.7';
    const lc = state.listenerCount;
    remain.textContent = lc > 0 ? `${lc} listening` : '∞';
  } else {
    elapsed.textContent   = fmt(state.elapsed);
    elapsed.style.color   = 'rgba(255,255,255,.3)';
    elapsed.style.opacity = '1';
    remain.textContent    = duration() > 0 ? `-${fmt(duration() - state.elapsed)}` : '∞';
  }

  // waveform disabled on live or preview (no seek)
  el('waveform').classList.toggle('disabled', !state.track || state.isPreview);

  // drawers
  setDrawer('lib-drawer',   state.showLib);
  setDrawer('queue-drawer', state.showQueue);
  const shareOpen = state.showShare && !state.showLib && !state.showQueue;
  const sharePanel = state.sharePanel === 'account' ? 'account' : 'share';
  setDrawer('share-drawer', shareOpen);
  el('lib-drawer').classList.toggle('open', state.showLib);
  el('queue-drawer').classList.toggle('open', state.showQueue);
  el('share-drawer').classList.toggle('open', shareOpen);
  el('share-drawer').dataset.panel = sharePanel;

  // share tab
  const shareUnlocked = !state.showLib && !state.showQueue;
  el('share-tab').classList.toggle('locked', !shareUnlocked);
  el('share-tab').classList.toggle('open', state.showShare && shareUnlocked);
  el('share-area').classList.toggle('active', shareOpen && sharePanel === 'share');
  el('account-area').classList.toggle('active', shareOpen && sharePanel === 'account');
  el('share-tab-label').textContent    = shareOpen && sharePanel === 'share' ? 'CLOSE' : 'SHARE';
  el('account-tab-label').textContent  = shareOpen && sharePanel === 'account' ? 'CLOSE' : 'ACCOUNT';
  el('share-chevron').style.transform  =
    shareOpen && sharePanel === 'share' ? 'rotate(180deg)' : 'none';

  setColor(t.color);
}

// ── Fullscreen ──────────────────────────────────────────────────────────────────────

function fsElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

export function toggleFullscreen() {
  const box = el('art-box');
  if (fsElement()) {
    (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
    return;
  }
  if (box.requestFullscreen) { box.requestFullscreen(); return; }
  if (box.webkitRequestFullscreen) { box.webkitRequestFullscreen(); return; }
  // iPhone Safari has no element-level Fullscreen API; fall back to native
  // video fullscreen, whose orientation follows physical device rotation
  // on its own — no orientation-lock call needed on that path.
  const activeVideo = !el('preview-video-el').hidden ? el('preview-video-el') : el('video-el');
  activeVideo?.webkitEnterFullscreen?.();
}

function syncFullscreenUI() {
  const active = fsElement() === el('art-box');
  el('art-box').classList.toggle('is-fullscreen', active);
  el('fullscreen-enter-icon').style.display = active ? 'none' : 'block';
  el('fullscreen-exit-icon').style.display  = active ? 'block' : 'none';

  // Mobile Chrome/Android only allows orientation lock while an element is
  // fullscreen; desktop and iOS Safari reject it, so failures are swallowed.
  if (active) {
    screen.orientation?.lock?.('landscape').catch(() => {});
  } else {
    screen.orientation?.unlock?.();
  }
}

document.addEventListener('fullscreenchange', syncFullscreenUI);
document.addEventListener('webkitfullscreenchange', syncFullscreenUI);

// ── Play / pause ──────────────────────────────────────────────────────────────────

export function togglePlay() {
  if (previewMedia) { stopPreview(); goLive(); return; }
  if (onDemandMedia) {
    if (onDemandMedia.paused) {
      onDemandMedia.play().then(() => {
        state.playing = true;
        render();
      }).catch(() => {
        state.playing = false;
        render();
      });
    } else {
      onDemandMedia.pause();
      state.playing = false;
      render();
    }
    return;
  }
  const media = activeMediaEl();
  if (media.paused) {
    if (!getHls() && !media.src) {
      setupHls(media);
      if (isVideoMode()) {
        media.hidden = false;
        el('audio-el').hidden = true;
      }
    }
    media.play().then(() => {
      state.playing = true;
      _asciiInitAudio();
      render();
      startPingInterval();
    }).catch(() => {
      state.playing = false;
      render();
    });
  } else {
    media.pause();
    state.playing = false;
    stopPingInterval();
    render();
  }
}

// ── Preview ───────────────────────────────────────────────────────────────────────

export function stopPreview() {
  if (previewMedia) {
    previewMedia.pause();
    if (previewMedia === el('preview-video-el')) {
      previewMedia.hidden = true;
      previewMedia.removeAttribute('src');
      previewMedia.load();
    }
    previewMedia = null;
  }
  clearTimeout(previewTimer);    previewTimer   = null;
  clearInterval(previewTickInt); previewTickInt = null;
}

function clearRevertTimer() {
  clearTimeout(revertTimer);
  revertTimer = null;
}

function stopOnDemand() {
  clearRevertTimer();
  if (!onDemandMedia) return;

  onDemandMedia.pause();
  onDemandMedia.ontimeupdate = null;
  onDemandMedia.onloadedmetadata = null;
  onDemandMedia.onended = null;
  onDemandMedia.onerror = null;
  if (onDemandMedia === el('preview-video-el')) {
    onDemandMedia.hidden = true;
    onDemandMedia.removeAttribute('src');
    onDemandMedia.load();
  } else {
    onDemandMedia.removeAttribute('src');
  }
  onDemandMedia = null;
}

function playPreview(t) {
  stopPreview();
  Object.assign(state, { track: { ...t, isPreview: true }, progress: 0, elapsed: 0, isPreview: true, showLib: false });
  render();
  const src = `/api/library/${t.id}/preview`;
  if (t.type === 'video') {
    const vidEl = el('preview-video-el');
    vidEl.hidden = false;
    vidEl.src = src;
    vidEl.play().catch(() => {});
    previewMedia = vidEl;
  } else {
    previewMedia = new Audio(src);
    previewMedia.play().catch(() => {});
  }
  let ticks = 0;
  previewTickInt = setInterval(() => {
    ticks += 0.25;
    state.elapsed  = Math.min(Math.floor(ticks), PREVIEW_SECS);
    state.progress = Math.min(ticks / PREVIEW_SECS, 1);
    render();
  }, 250);
  previewTimer = setTimeout(() => {
    stopPreview();
    goLive();
  }, PREVIEW_SECS * 1000);
}

export async function startGatedPreview(t) {
  playPreview(t);
  if (t.visibility === 'vault') {
    await _checkVaultGate(t);
  } else if (t.visibility === 'supporters_only') {
    _openModal(); _setModalTab('subscribe');
  }
}

// ── VOD selection ─────────────────────────────────────────────────────────────────

export function setNextUp(t) {
  nextUpTrack = t ? { ...t } : null;
}

export function handleNowPlayingChange() {
  if (!nextUpTrack || state.track || previewMedia || onDemandMedia) return;
  const track = nextUpTrack;
  nextUpTrack = null;
  playOnDemand(track, { nextUp: true });
}

function updateOnDemandProgress() {
  if (!onDemandMedia || !state.track) return;
  const mediaDuration = Number.isFinite(onDemandMedia.duration) ? onDemandMedia.duration : 0;
  if (!state.track.duration && mediaDuration > 0) state.track.duration = mediaDuration;
  const d = duration() || mediaDuration;
  state.elapsed = onDemandMedia.currentTime || 0;
  state.progress = d > 0 ? Math.min(state.elapsed / d, 1) : 0;
  render();
}

async function handleOnDemandError({ nextUp = false } = {}) {
  const failedTrack = state.track ? { ...state.track } : null;
  try {
    quota = await api.library.streamQuota();
    if (quota.limit && quota.remaining === 0) {
      const mins = quota.resetSec ? Math.ceil(quota.resetSec / 60) : 60;
      // Only convert the failed press into the next-up slot while the hourly
      // bonus is unspent — otherwise the deferred play would 429 too.
      if (!nextUp && failedTrack && !isPaidTier() && quota.nextUpAvailable !== false) {
        setNextUp(failedTrack);
        showToast(`${quota.limit} ON-DEMAND PLAYS USED. NEXT-UP ARMED.`);
      } else {
        showToast(`${quota.limit} ON-DEMAND PLAYS USED THIS HOUR. RESET IN ${mins} ${mins === 1 ? 'MIN' : 'MINS'}`);
      }
    } else {
      showToast('Playback unavailable');
    }
  } catch {
    showToast('Playback unavailable');
  }
  goLive({ resume: true });
}

function playNextAfterOnDemand() {
  stopOnDemand();
  if (isPaidTier()) {
    const next = _takeNextQueueTrack();
    if (next) {
      playOnDemand(next);
      return;
    }
  }
  revertTimer = setTimeout(() => goLive({ resume: true }), 30_000);
  Object.assign(state, { playing: false, progress: 1, elapsed: duration() });
  render();
}

export async function playOnDemand(t, { nextUp = false } = {}) {
  if (!t?.id) return;
  stopPreview();
  stopOnDemand();
  clearRevertTimer();

  const liveEl = activeMediaEl();
  if (liveEl) {
    try { liveEl.pause(); } catch {}
  }
  stopPingInterval();

  if (t.type !== 'video') {
    const liveVideo = el('video-el');
    if (liveVideo) liveVideo.hidden = true;
  }

  Object.assign(state, {
    track: { ...t, isPreview: false },
    progress: 0,
    elapsed: 0,
    isPreview: false,
    playing: false,
    showLib: false,
  });
  render();

  const src = api.library.streamUrl(t.id, { nextUp });
  if (t.type === 'video') {
    const vidEl = el('preview-video-el');
    vidEl.hidden = false;
    vidEl.src = src;
    onDemandMedia = vidEl;
  } else {
    onDemandMedia = new Audio(src);
  }

  onDemandMedia.onloadedmetadata = updateOnDemandProgress;
  onDemandMedia.ontimeupdate = updateOnDemandProgress;
  onDemandMedia.onended = playNextAfterOnDemand;
  onDemandMedia.onerror = () => handleOnDemandError({ nextUp });

  try {
    await onDemandMedia.play();
    state.playing = true;
    render();
    loadQuota().then(render);
  } catch {
    state.playing = false;
    render();
  }
}

export async function selectVOD(t) {
  if (!t) return;
  if (!isPlayableTrack(t)) {
    await startGatedPreview(t);
    return;
  }
  await playOnDemand(t);
  _buildLibrary();
}

export function goLive(opts = {}) {
  const resume = opts?.resume === true;
  stopPreview();
  stopOnDemand();
  Object.assign(state, { track: null, progress: 0, elapsed: 0, isPreview: false, playing: false });
  if (isVideoMode()) {
    const videoEl = el('video-el');
    const audioEl = el('audio-el');
    if (videoEl) videoEl.hidden = false;
    if (audioEl) audioEl.hidden = true;
  }
  render();
  loadQuota().then(render);
  if (!resume) return;

  const media = activeMediaEl();
  if (!getHls() && !media.src) setupHls(media);
  media.play().then(() => {
    state.playing = true;
    _asciiInitAudio();
    render();
    startPingInterval();
  }).catch(() => {
    state.playing = false;
    render();
  });
}

// ── Skip / seek ───────────────────────────────────────────────────────────────────

export function skipTrack(dir) {
  if (!state.track) return;
  if (dir > 0 && isPaidTier()) {
    const next = _takeNextQueueTrack();
    if (next) {
      selectVOD(next);
      return;
    }
  }
  const playable = LIBRARY.filter(isPlayableTrack);
  const idx = playable.findIndex(t => t.id === state.track?.id);
  if (idx < 0) return;
  selectVOD(playable[(idx + dir + playable.length) % playable.length]);
}

export function seekWaveform(e) {
  if (!state.track || state.isPreview || !duration()) return;
  const rect     = el('waveform').getBoundingClientRect();
  state.progress = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  state.elapsed  = Math.floor(state.progress * duration());
  if (onDemandMedia) onDemandMedia.currentTime = state.elapsed;
  renderWaveform();
  el('time-elapsed').textContent = fmt(state.elapsed);
  el('time-remain').textContent  = `-${fmt(duration() - state.elapsed)}`;
}

// ── Drawers / share ───────────────────────────────────────────────────────────────

export function toggleDrawer(which) {
  if (which === 'lib') {
    state.showLib   = !state.showLib;
    state.showQueue = false;
    if (state.showLib) state.showShare = false;
  } else {
    state.showQueue = !state.showQueue;
    state.showLib   = false;
    if (state.showQueue) { state.showShare = false; _loadQueue(); }
  }
  render();
}

export function toggleShare() {
  if (state.showLib || state.showQueue) return;
  if (state.showShare && state.sharePanel === 'share') {
    state.showShare = false;
  } else {
    state.showShare = true;
    state.sharePanel = 'share';
  }
  render();
}

// ── Share options (copy link / twitter / embed / rss) ─────────────────────────────
// Relocated here in Phase 8: this wiring existed in the original inline script but
// was not captured by any Phase 5/6 module. It belongs with player.js because it
// reads activeTrack().color and getStationName() (hls-client), both already
// available in this module.

export function initShareHandlers() {
  document.querySelectorAll('.share-opt').forEach(btn => {
    btn.addEventListener('mouseenter', () => {
      const c = activeTrack().color;
      btn.style.background  = `${c}18`;
      btn.style.borderColor = `${c}44`;
    });
    btn.addEventListener('mouseleave', () => {
      if (btn.classList.contains('copied')) return;
      btn.style.background  = 'rgba(255,255,255,.04)';
      btn.style.borderColor = 'rgba(255,255,255,.08)';
    });
    btn.addEventListener('click', () => {
      const action = btn.dataset.share;
      if (action === 'link') {
        navigator.clipboard?.writeText(window.location.href).catch(() => {});
        const icon  = btn.querySelector('.share-opt-icon');
        const label = btn.querySelector('.share-opt-label');
        btn.classList.add('copied');
        icon.textContent  = '✓';
        label.textContent = 'COPIED';
        setTimeout(() => {
          btn.classList.remove('copied');
          icon.textContent  = '⌗';
          label.textContent = 'COPY LINK';
          btn.style.background  = 'rgba(255,255,255,.04)';
          btn.style.borderColor = 'rgba(255,255,255,.08)';
        }, 2000);
      } else if (action === 'twitter') {
        const text = encodeURIComponent(`Listening to ${getStationName()} — ${window.location.href}`);
        window.open(`https://twitter.com/intent/tweet?text=${text}`, '_blank');
      } else if (action === 'embed') {
        const code = `<iframe src="${window.location.origin}/embed" width="420" height="96" style="border:0;" title="Radio player" allow="autoplay"></iframe>`;
        navigator.clipboard?.writeText(code).catch(() => {});
        const lbl = btn.querySelector('.share-opt-label');
        lbl.textContent = 'COPIED';
        setTimeout(() => { lbl.textContent = 'EMBED'; }, 2000);
      } else if (action === 'rss') {
        window.open('/feed.xml', '_blank');
      }
    });
  });
}
