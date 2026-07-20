/**
 * stack.js - Listener catalog + browser-side stash panel.
 *
 * The module renders only when the STACK tab is opened. It reads the live
 * LIBRARY_STRUCTURE object populated by library.js and receives player/payment
 * callbacks from main.js to avoid sibling imports.
 */

import { state, LIBRARY_STRUCTURE, authState } from './state.js';
import { el, esc, fmt, showToast, trackColor, generateWaveform } from './utils.js';
import * as api from './api.js';
import * as offline from './offline.js';
import { normalizeTrack } from './library.js';

let initialized = false;
let openKey = 'stack';
let quota = null;
let savedSet = new Set();
const openProjects = new Set();
// Folders default open the first time they appear, but a listener's close
// must survive re-renders — seenProjects marks which keys already got their
// default so refresh() doesn't force them open again.
const seenProjects = new Set();

let _selectVOD = () => {};
let _openModal = () => {};
let _setModalTab = () => {};
let _checkVaultGate = async () => false;
let _addToQueue = () => false;
let _setNextUp = () => {};

export function init({
  selectVOD,
  openModal,
  setModalTab,
  checkVaultGate,
  addToQueue,
  setNextUp,
} = {}) {
  if (selectVOD)      _selectVOD      = selectVOD;
  if (openModal)      _openModal      = openModal;
  if (setModalTab)    _setModalTab    = setModalTab;
  if (checkVaultGate) _checkVaultGate = checkVaultGate;
  if (addToQueue)     _addToQueue     = addToQueue;
  if (setNextUp)      _setNextUp      = setNextUp;
}

function isPaidTier() {
  return document.body.classList.contains('creator-mode')
    || (authState.loggedIn && authState.tier !== 'free');
}

function isPlayable(t) {
  if (!t || t.isExternal) return false;
  if (t.visibility === 'public') return true;
  if (t.visibility === 'supporters_only') return t.unlocked === true || isPaidTier();
  if (t.visibility === 'vault') return t.unlocked === true;
  return true;
}

function canStash(t) {
  return isPlayable(t) && (t.offlineAllowed || (t.visibility === 'vault' && t.unlocked === true));
}

function maskTitle(title) {
  const len = Math.max(6, Math.min(18, String(title || '').length || 8));
  return '*'.repeat(len);
}

function bodyFor(card) {
  return card.querySelector('.stack-card-body');
}

function setCardOpen(card, isOpen, { animate = true } = {}) {
  const body = bodyFor(card);
  card.classList.toggle('open', isOpen);
  card.querySelector('.stack-card-head')
    .setAttribute('aria-expanded', isOpen ? 'true' : 'false');

  if (!animate) {
    body.style.height = isOpen ? 'auto' : '0px';
    return;
  }

  if (isOpen) {
    const target = body.scrollHeight;
    body.style.height = '0px';
    requestAnimationFrame(() => { body.style.height = `${target}px`; });
    body.addEventListener('transitionend', function onEnd(e) {
      if (e.propertyName !== 'height') return;
      body.removeEventListener('transitionend', onEnd);
      if (card.classList.contains('open')) body.style.height = 'auto';
    });
  } else {
    body.style.height = `${body.scrollHeight}px`;
    requestAnimationFrame(() => { body.style.height = '0px'; });
  }
}

function applyAccordion() {
  const container = el('stack-sections');
  if (!container) return;
  container.querySelectorAll('.stack-card').forEach(card => {
    setCardOpen(card, card.dataset.stackKey === openKey, { animate: false });
  });
}

function makeCard(key, title) {
  const card = document.createElement('section');
  card.className = 'stack-card';
  card.dataset.stackKey = key;
  card.innerHTML = `
    <button class="stack-card-head" type="button" aria-expanded="false">
      <span class="stack-card-chevron" aria-hidden="true">&#9662;</span>
      <span class="stack-card-title">${esc(title)}</span>
    </button>
    <div class="stack-card-body"><div class="stack-card-content"></div></div>
  `;
  card.querySelector('.stack-card-head').addEventListener('click', () => {
    if (openKey === key) return;
    const oldKey = openKey;
    openKey = key;
    const container = el('stack-sections');
    const oldCard = container.querySelector(`.stack-card[data-stack-key="${oldKey}"]`);
    const newCard = container.querySelector(`.stack-card[data-stack-key="${key}"]`);
    if (oldCard) setCardOpen(oldCard, false);
    if (newCard) setCardOpen(newCard, true);
  });
  return card;
}

function ensureCards() {
  const container = el('stack-sections');
  if (!container || initialized) return;
  initialized = true;
  container.appendChild(makeCard('stack', 'STACK'));
  container.appendChild(makeCard('stash', 'STASH'));
  applyAccordion();
}

function trackMeta(t) {
  return [t.creator, t.duration ? fmt(t.duration) : '', t.genre].filter(Boolean).join(' / ');
}

function quotaExhausted() {
  return !isPaidTier() && quota?.limit && quota.remaining === 0;
}

function quotaResetMins() {
  return Math.max(1, Math.ceil((quota?.resetSec || 3600) / 60));
}

function armNextUp(t) {
  // The hourly next-up bonus is single-use; once spent, arming another pick
  // would just 429 when it fires, so tell the listener when plays return.
  if (quota && quota.nextUpAvailable === false) {
    if (quota.emailRequired) {
      showToast('Add your email in Settings for 5 plays/hour');
    } else {
      showToast(`Hourly on-demand plays used — resets in ${quotaResetMins()} min`);
    }
    return;
  }
  _setNextUp(t);
  showToast('Next-up armed. This pick will play after the current broadcast track ends.');
}

function handlePlay(t) {
  if (t.isExternal) {
    showToast('External imports are not available for on-demand playback');
    return;
  }
  if (t.visibility === 'supporters_only' && !isPlayable(t)) {
    _openModal();
    _setModalTab('subscribe');
    return;
  }
  if (t.visibility === 'vault' && !isPlayable(t)) {
    _checkVaultGate(t);
    return;
  }
  if (quotaExhausted()) {
    armNextUp(t);
    return;
  }
  _selectVOD(t);
}

function makeTrackRow(raw) {
  const t = normalizeTrack(raw);
  const playable = isPlayable(t);
  const lockedSupporter = t.visibility === 'supporters_only' && !playable;
  const lockedVault = t.visibility === 'vault' && !playable;
  const title = lockedVault ? maskTitle(t.title) : t.title;
  const row = document.createElement('div');
  row.className = [
    'stack-row',
    playable ? 'stack-row-playable' : '',
    lockedSupporter || t.isExternal ? 'stack-row-locked' : '',
    lockedVault ? 'stack-row-redacted' : '',
  ].filter(Boolean).join(' ');
  row.innerHTML = `
    <div class="stack-row-main">
      <div class="stack-row-title">${esc(title)}</div>
      <div class="stack-row-meta">${esc(t.isExternal ? 'EXTERNAL IMPORT' : trackMeta(t))}</div>
    </div>
    <div class="stack-row-actions"></div>
  `;
  row.addEventListener('click', () => handlePlay(t));

  const actions = row.querySelector('.stack-row-actions');
  if (playable) {
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'stack-btn stack-btn-queue';
    add.textContent = '+';
    add.title = 'Add to queue';
    add.addEventListener('click', e => {
      e.stopPropagation();
      if (quotaExhausted()) armNextUp(t);
      else _addToQueue(t);
    });
    actions.appendChild(add);
  }

  if (canStash(t)) {
    const stash = document.createElement('button');
    stash.type = 'button';
    const saved = savedSet.has(t.id);
    stash.className = 'stack-btn stack-btn-stash' + (saved ? ' saved' : '');
    stash.textContent = saved ? '✓ STASHED' : 'STASH';
    stash.title = saved ? 'In your offline stash' : 'Save to your offline stash';
    stash.addEventListener('click', async e => {
      e.stopPropagation();
      if (savedSet.has(t.id)) return;
      stash.disabled = true;
      const ok = await offline.saveTrack(t);
      stash.disabled = false;
      if (ok) {
        savedSet.add(t.id);
        stash.classList.add('saved');
        stash.textContent = '✓ STASHED';
        stash.title = 'In your offline stash';
        refreshStash();
      }
    });
    actions.appendChild(stash);
  }

  return row;
}

function makeFolder(project, { keyPrefix = 'collection' } = {}) {
  const key = `${keyPrefix}:${String(project.id || project.name)}`;
  const tracks = project.tracks || [];
  if (!seenProjects.has(key)) {
    seenProjects.add(key);
    openProjects.add(key);
  }

  const folder = document.createElement('div');
  folder.className = 'stack-folder';
  folder.classList.toggle('open', openProjects.has(key));
  folder.innerHTML = `
    <button class="stack-folder-head" type="button" aria-expanded="${openProjects.has(key) ? 'true' : 'false'}">
      <span class="stack-folder-chevron" aria-hidden="true">&#9662;</span>
      <span class="stack-folder-glyph" aria-hidden="true"></span>
      <span class="stack-folder-name">${esc(project.name)}</span>
      <span class="stack-folder-count">${tracks.length}</span>
    </button>
    <div class="stack-folder-body"><div class="stack-tree"></div></div>
  `;
  folder.querySelector('.stack-folder-head').addEventListener('click', () => {
    if (openProjects.has(key)) openProjects.delete(key);
    else openProjects.add(key);
    const isOpen = openProjects.has(key);
    folder.classList.toggle('open', isOpen);
    folder.querySelector('.stack-folder-head').setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  });
  const body = folder.querySelector('.stack-tree');
  tracks.forEach(track => body.appendChild(makeTrackRow(track)));
  return folder;
}

function renderStack() {
  const card = el('stack-sections')?.querySelector('.stack-card[data-stack-key="stack"] .stack-card-content');
  if (!card) return;
  card.innerHTML = '';

  const { projects = [], standalone = [] } = LIBRARY_STRUCTURE;
  if (!projects.length && !standalone.length) {
    card.innerHTML += '<div class="stack-empty">NO UPLOADS YET</div>';
    return;
  }

  projects.forEach(project => card.appendChild(makeFolder(project)));
  if (standalone.length) {
    card.appendChild(makeFolder({ id: 'singles', name: 'SINGLES', tracks: standalone }, { keyPrefix: 'release-type' }));
  }
}

function fallbackTrack(saved) {
  const all = [
    ...(LIBRARY_STRUCTURE.projects || []).flatMap(project => project.tracks || []),
    ...(LIBRARY_STRUCTURE.standalone || []),
  ];
  const raw = all.find(track => Number(track.id) === Number(saved.id));
  if (raw) return normalizeTrack(raw);
  return {
    id: saved.id,
    title: saved.title || `Track #${saved.id}`,
    creator: '',
    type: (saved.mimeType || '').startsWith('video/') ? 'video' : 'audio',
    duration: 0,
    color: trackColor(saved.id),
    waveform: generateWaveform(saved.id),
    visibility: 'public',
    unlocked: true,
  };
}

async function refreshStash() {
  const card = el('stack-sections')?.querySelector('.stack-card[data-stack-key="stash"] .stack-card-content');
  if (!card) return;
  const saved = await offline.listSaved();
  card.innerHTML = '';

  if (!saved.length) {
    card.innerHTML = '<div class="stack-empty">NO STASHED TRACKS</div>';
    return;
  }

  saved.sort((a, b) => String(b.savedAt || '').localeCompare(String(a.savedAt || '')));
  for (const item of saved) {
    const track = fallbackTrack(item);
    const row = document.createElement('div');
    row.className = 'stack-row stack-row-playable stack-stash-row';
    row.innerHTML = `
      <div class="stack-row-main">
        <div class="stack-row-title">${esc(track.title)}</div>
        <div class="stack-row-meta">${esc(item.size ? `${Math.round(item.size / 1024)} KB` : 'SAVED LOCALLY')}</div>
      </div>
      <div class="stack-row-actions">
        <button class="stack-btn stack-btn-play" type="button">PLAY</button>
        <button class="stack-btn stack-btn-queue" type="button">+</button>
        <button class="stack-btn stack-btn-remove" type="button">X</button>
      </div>
    `;
    row.querySelector('.stack-btn-play').addEventListener('click', e => {
      e.stopPropagation();
      offline.playSaved(item.id);
    });
    row.querySelector('.stack-btn-queue').addEventListener('click', e => {
      e.stopPropagation();
      if (quotaExhausted()) armNextUp(track);
      else _addToQueue(track);
    });
    row.querySelector('.stack-btn-remove').addEventListener('click', async e => {
      e.stopPropagation();
      await offline.removeSaved(item.id);
      savedSet.delete(item.id);
      refreshStash();
      renderStack();
    });
    card.appendChild(row);
  }
}

async function loadQuota() {
  if (isPaidTier()) {
    quota = { limit: null, remaining: null, resetSec: 0 };
    state.quota = null;
    return;
  }
  try { quota = await api.library.streamQuota(); }
  catch { quota = null; }
  state.quota = quota;
}

export async function refresh() {
  if (!initialized) return;
  await loadQuota();
  savedSet = await offline.savedIds();
  renderStack();
  await refreshStash();
  applyAccordion();
}

export async function initStackView() {
  ensureCards();
  await refresh();
}
