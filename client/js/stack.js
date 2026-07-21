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
let _onStashChanged = () => {};
let _editTrack = () => {};

export function init({
  selectVOD,
  openModal,
  setModalTab,
  checkVaultGate,
  addToQueue,
  setNextUp,
  onStashChanged,
  editTrack,
} = {}) {
  if (selectVOD)      _selectVOD      = selectVOD;
  if (openModal)      _openModal      = openModal;
  if (setModalTab)    _setModalTab    = setModalTab;
  if (checkVaultGate) _checkVaultGate = checkVaultGate;
  if (addToQueue)     _addToQueue     = addToQueue;
  if (setNextUp)      _setNextUp      = setNextUp;
  if (onStashChanged) _onStashChanged = onStashChanged;
  if (editTrack)      _editTrack      = editTrack;
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

function isCreatorMode() {
  return document.body.classList.contains('creator-mode');
}

function setCardOpen(card, isOpen) {
  card.classList.toggle('open', isOpen);
  card.querySelector('.stack-card-head')
    .setAttribute('aria-expanded', isOpen ? 'true' : 'false');
}

function applyAccordion() {
  const container = el('stack-sections');
  if (!container) return;
  container.querySelectorAll('.stack-card').forEach(card => {
    setCardOpen(card, card.dataset.stackKey === openKey);
  });
}

function makeCard(key, title) {
  const card = document.createElement('section');
  card.className = 'stack-card';
  card.id = `stack-card-${key}`;
  card.dataset.stackKey = key;
  card.innerHTML = `
    <button class="stack-card-head" type="button" aria-expanded="false">
      <span class="stack-card-title">
        <span>${esc(title)}</span>
        <span class="stack-card-badge${key === 'stash' ? ' stash-count' : ''}">0 ${key === 'stash' ? 'SAVED' : 'TRACKS'}</span>
        <span class="stack-card-peek">0 ${key === 'stash' ? 'SAVED' : 'TRACKS'}</span>
      </span>
      <span class="stack-card-chevron" aria-hidden="true">&#9662;</span>
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

function updateCardCount(key, count) {
  const card = el(`stack-card-${key}`);
  if (!card) return;
  const label = `${count} ${key === 'stash' ? 'SAVED' : 'TRACKS'}`;
  const badge = card.querySelector('.stack-card-badge');
  const peek = card.querySelector('.stack-card-peek');
  if (badge) badge.textContent = label;
  if (peek) peek.textContent = label;
}

function trackMeta(t) {
  return [t.creator, t.duration ? fmt(t.duration) : '', t.genre].filter(Boolean).join(' / ');
}

function savedAge(savedAt) {
  const savedMs = Date.parse(savedAt || '');
  if (!Number.isFinite(savedMs)) return 'SAVED LOCALLY';
  const elapsed = Math.max(0, Date.now() - savedMs);
  const days = Math.floor(elapsed / 86400000);
  if (days < 1) return 'SAVED TODAY';
  if (days < 7) return `SAVED ${days}D AGO`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `SAVED ${weeks}W AGO`;
  const months = Math.floor(days / 30);
  return `SAVED ${Math.max(1, months)}MO AGO`;
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
  const creatorMode = isCreatorMode();
  const playable = isPlayable(t);
  const lockedSupporter = t.visibility === 'supporters_only' && !playable;
  const lockedVault = t.visibility === 'vault' && !playable;
  const title = lockedVault ? maskTitle(t.title) : t.title;
  const meta = lockedVault
    ? '<span class="tier-chip vault">VAULT</span>'
    : `${esc(t.isExternal ? 'EXTERNAL IMPORT' : trackMeta(t))}${lockedSupporter ? ' <span class="tier-chip supporter">SUPPORTERS</span>' : ''}`;
  const row = document.createElement('div');
  row.className = [
    'stack-row',
    playable ? 'stack-row-public stack-row-playable' : '',
    lockedSupporter || t.isExternal ? 'stack-row-locked' : '',
    lockedVault ? 'stack-row-redacted' : '',
  ].filter(Boolean).join(' ');
  row.innerHTML = `
    <div class="stack-row-main">
      <div class="stack-row-title">${esc(title)}</div>
      <div class="stack-row-meta">${meta}</div>
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

  if (!creatorMode && canStash(t)) {
    const stash = document.createElement('button');
    stash.type = 'button';
    const saved = savedSet.has(t.id);
    stash.className = 'stack-btn stack-btn-stash' + (saved ? ' saved' : '');
    stash.textContent = 'STASH';
    stash.title = saved ? 'Remove from Stash' : 'Add to Stash';
    stash.addEventListener('click', async e => {
      e.stopPropagation();
      stash.disabled = true;
      const wasSaved = savedSet.has(t.id);
      const ok = wasSaved
        ? await offline.removeSaved(t.id)
        : await offline.saveTrack(t);
      stash.disabled = false;
      if (ok) {
        if (wasSaved) savedSet.delete(t.id);
        else savedSet.add(t.id);
        renderStack();
        await refreshStash();
        await _onStashChanged();
      }
    });
    actions.appendChild(stash);
  }

  if (creatorMode) {
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'stack-btn stack-btn-edit';
    edit.textContent = 'EDIT';
    edit.title = 'Edit in Studio Vault';
    edit.addEventListener('click', e => {
      e.stopPropagation();
      _editTrack(t.id);
    });
    actions.appendChild(edit);
  }

  if (!creatorMode && lockedVault) {
    const unlock = document.createElement('button');
    unlock.type = 'button';
    unlock.className = 'stack-btn stack-btn-unlock';
    unlock.textContent = 'UNLOCK';
    unlock.title = 'Unlock this track';
    unlock.addEventListener('click', e => {
      e.stopPropagation();
      _checkVaultGate(t);
    });
    actions.appendChild(unlock);
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
  const trackCount = projects.reduce((total, project) => total + (project.tracks || []).length, 0) + standalone.length;
  updateCardCount('stack', trackCount);
  if (!projects.length && !standalone.length) {
    card.innerHTML += '<div class="stack-empty">NO UPLOADS YET</div>';
    return;
  }

  projects.forEach(project => card.appendChild(makeFolder(project)));
  if (standalone.length) {
    card.appendChild(makeFolder({ id: 'singles', name: 'SINGLES', tracks: standalone }, { keyPrefix: 'release-type' }));
  }
}

function findLibraryTrack(id) {
  const all = [
    ...(LIBRARY_STRUCTURE.projects || []).flatMap(project => project.tracks || []),
    ...(LIBRARY_STRUCTURE.standalone || []),
  ];
  return all.find(track => Number(track.id) === Number(id)) || null;
}

function fallbackTrack(saved) {
  const raw = findLibraryTrack(saved.id);
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
  savedSet = new Set(saved.map(item => item.id));
  card.innerHTML = '';
  updateCardCount('stash', saved.length);

  if (!saved.length) {
    card.innerHTML = '<div class="stack-empty">NO STASHED TRACKS</div>';
    return;
  }

  saved.sort((a, b) => String(b.savedAt || '').localeCompare(String(a.savedAt || '')));
  const recent = document.createElement('div');
  recent.className = 'stash-recent-strip';
  recent.setAttribute('aria-label', 'Recently saved');
  saved.slice(0, 6).forEach(item => {
    const recentItem = document.createElement('div');
    recentItem.className = 'stash-recent-item';
    recentItem.innerHTML = `
      <div class="stash-recent-art" aria-hidden="true"></div>
      <div class="stash-recent-title">${esc(item.title || `Track #${item.id}`)}</div>
    `;
    recent.appendChild(recentItem);
  });
  card.appendChild(recent);

  const separator = document.createElement('div');
  separator.className = 'stack-sep';
  separator.textContent = `ALL SAVED / ${saved.length}`;
  card.appendChild(separator);

  for (const item of saved) {
    const currentLibraryTrack = findLibraryTrack(item.id);
    const track = fallbackTrack(item);
    const creatorMode = isCreatorMode();
    const row = document.createElement('div');
    row.className = 'stack-row stack-row-public stack-row-playable stack-stash-row';
    const meta = [track.duration ? fmt(track.duration) : '', savedAge(item.savedAt)].filter(Boolean).join(' / ');
    row.innerHTML = `
      <div class="stack-row-main">
        <div class="stack-row-title">${esc(track.title)}</div>
        <div class="stack-row-meta">${esc(meta)}</div>
      </div>
      <div class="stack-row-actions">
        <button class="stack-btn stack-btn-queue" type="button" title="Add to queue">+</button>
        ${creatorMode && currentLibraryTrack
          ? '<button class="stack-btn stack-btn-edit" type="button" title="Edit in Studio Vault">EDIT</button>'
          : !creatorMode
            ? '<button class="stack-btn stack-btn-stash saved" type="button" title="Remove from Stash">STASH</button>'
            : ''}
      </div>
    `;
    row.addEventListener('click', () => offline.playSaved(item.id));
    row.querySelector('.stack-btn-queue').addEventListener('click', e => {
      e.stopPropagation();
      if (quotaExhausted()) armNextUp(track);
      else _addToQueue(track);
    });
    const stashButton = row.querySelector('.stack-btn-stash');
    if (stashButton) {
      stashButton.addEventListener('click', async e => {
        e.stopPropagation();
        const button = e.currentTarget;
        button.disabled = true;
        const removed = await offline.removeSaved(item.id);
        button.disabled = false;
        if (!removed) return;
        savedSet.delete(item.id);
        renderStack();
        await refreshStash();
        await _onStashChanged();
      });
    }
    row.querySelector('.stack-btn-edit')?.addEventListener('click', e => {
      e.stopPropagation();
      _editTrack(track.id);
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
