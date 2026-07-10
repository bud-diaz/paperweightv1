/**
 * library.js — Library data loading, DOM list building, listener queue.
 *
 * Owns local state: listenerQueue (reassigned on clear — cannot import from state.js).
 * Mutates LIBRARY (via .length = 0 + push) and LIBRARY_STRUCTURE (via Object.assign)
 * rather than whole-object replacing, because those are live ES module exports.
 *
 * Callbacks injected via init() for cross-module calls:
 *   selectVOD, startGatedPreview — from player.js
 *   openModal, setModalTab       — from modal.js (Phase 6)
 *
 * Event wiring (initListenerQueueHandlers) is deferred to Phase 8 main.js.
 */

import { state, LIBRARY, LIBRARY_STRUCTURE, authState } from './state.js';
import { el, showToast, trackColor, generateWaveform, fmt, esc } from './utils.js';
import * as api from './api.js';

// ── Module-local state ────────────────────────────────────────────────────────

let listenerQueue = [];

// ── Injected callbacks ────────────────────────────────────────────────────────

let _selectVOD        = () => {};
let _startGatedPreview = () => {};
let _openModal        = () => {};
let _setModalTab      = () => {};
let _openLibraryModal = () => {};
let _checkVaultGate   = async () => false;

/**
 * Register cross-module callbacks.
 * Called from main.js in Phase 8.
 *
 * @param {{ selectVOD, startGatedPreview, openModal, setModalTab, openLibraryModal, checkVaultGate }} cbs
 */
export function init({ selectVOD, startGatedPreview, openModal, setModalTab, openLibraryModal, checkVaultGate } = {}) {
  if (selectVOD)         _selectVOD         = selectVOD;
  if (startGatedPreview) _startGatedPreview  = startGatedPreview;
  if (openModal)         _openModal          = openModal;
  if (setModalTab)       _setModalTab        = setModalTab;
  if (openLibraryModal)  _openLibraryModal   = openLibraryModal;
  if (checkVaultGate)    _checkVaultGate     = checkVaultGate;
}

// ── Track normalization ───────────────────────────────────────────────────────

export function normalizeTrack(item) {
  return {
    id:         item.id,
    type:       item.isVideo ? 'video' : 'audio',
    title:      item.title || 'Untitled',
    duration:   item.duration || 0,
    date:       item.indexedAt
                  ? new Date(item.indexedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                  : '',
    color:      trackColor(item.id),
    creator:    item.artist || '',
    visibility: item.visibility || 'public',
    genre:      item.genre || null,
    isLive:     false,
    artworkUrl: item.artwork_url || null,
    waveform:   generateWaveform(item.id),
    // Papercut-style commerce/save state (from formatItem's ownership context)
    unlocked:       item.unlocked,
    price:          item.price || null,
    offlineAllowed: !!item.offlineAllowed,
    mimeType:       item.mimeType || null,
  };
}

// ── Library fetch ─────────────────────────────────────────────────────────────

export async function loadLibrary() {
  try {
    const data = await api.library.structure();
    Object.assign(LIBRARY_STRUCTURE, data);
    LIBRARY.length = 0;
    for (const proj of (data.projects  || [])) proj.tracks.forEach(t => LIBRARY.push(normalizeTrack(t)));
    for (const t    of (data.standalone || []))  LIBRARY.push(normalizeTrack(t));
    buildLibrary();
  } catch {}
}

// ── Library DOM ───────────────────────────────────────────────────────────────

export function buildLibRow(t, onClick) {
  const row = document.createElement('div');
  row.className = 'lib-row';
  const isActive = state.track && state.track.id === t.id;
  if (isActive) { row.classList.add('active'); row.style.borderLeftColor = t.color; }
  // Owned state from the server's ownership context: an unlocked vault track
  // shows as owned rather than gated (Papercut's "in your collection" mark).
  const isOwned = t.visibility === 'vault' && t.unlocked === true;
  const isGated = !isOwned && (t.visibility === 'supporters_only' || t.visibility === 'vault');
  const priceLabel = t.price
    ? (t.price.allowFree ? 'FREE' : `$${((t.price.minimum || t.price.suggested) / 100).toFixed(2)}`)
    : '$';
  const thumbContent = t.artworkUrl
    ? `<img src="/api/library/${t.id}/artwork" loading="lazy" onerror="this.style.display='none'"/>`
    : `<span>${t.type === 'video' ? '▶' : '♪'}</span>`;
  row.innerHTML = `
    <div class="lib-thumb" style="background:linear-gradient(135deg,${t.color}44,${t.color}11);border:1px solid ${t.color}33;">${thumbContent}<button class="lib-queue-btn" data-id="${t.id}" data-title="${esc(t.title)}" data-artist="${esc(t.creator)}" title="Add to queue">+</button></div>
    <div class="lib-info">
      <div class="lib-title${isActive ? ' active' : ''}">
        ${esc(t.title)}${isGated ? '<span class="lib-lock">⬡</span>' : ''}${isOwned ? '<span class="lib-owned" title="In your collection">✓</span>' : ''}
      </div>
      <div class="lib-meta">${t.date}${t.date && t.duration ? ' · ' : ''}${t.duration ? fmt(t.duration) : ''}${t.genre ? ' · ' + esc(t.genre) : ''}</div>
    </div>
    <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
      <span class="type-badge" style="background:${t.color};font-size:11px;padding:2px 6px;">${t.type === 'video' ? '● VIDEO' : '◉ AUDIO'}</span>
      ${isGated ? `<button class="lib-dollar-btn" title="Unlock this track">${t.visibility === 'vault' && t.price ? esc(priceLabel) : '$'}</button>` : ''}
    </div>
  `;
  if (isGated) {
    row.querySelector('.lib-dollar-btn').addEventListener('click', async e => {
      e.stopPropagation();
      // Vault tracks open the unlock gate (per-track buy); supporters-only
      // content routes to the subscribe modal as before.
      if (t.visibility === 'vault' && await _checkVaultGate(t)) return;
      _openModal(); _setModalTab('subscribe');
    });
  }
  row.addEventListener('click', () => (onClick || _selectVOD)(t));
  return row;
}

function buildLibProjectSection(proj, onTrackClick) {
  const section = document.createElement('div');
  section.className = 'lib-project';

  const firstVaultTrack = proj.tracks.find(t => t.visibility === 'vault');
  const isGated = !!firstVaultTrack;

  const header = document.createElement('div');
  header.className = 'lib-project-header';
  header.innerHTML = `
    <span style="font-size:13px;color:rgba(255,255,255,.25);">⬡</span>
    <span class="lib-project-name">${esc(proj.name)}</span>
    <span class="lib-project-count">${proj.tracks.length}</span>
    ${isGated ? '<button class="lib-proj-unlock-btn">SUPPORT TO UNLOCK</button>' : ''}
    <span class="lib-project-chev">›</span>`;

  if (isGated) {
    header.querySelector('.lib-proj-unlock-btn').addEventListener('click', e => {
      e.stopPropagation();
      _startGatedPreview(normalizeTrack(firstVaultTrack));
    });
  }

  header.addEventListener('click', e => {
    if (e.target.classList.contains('lib-proj-unlock-btn')) return;
    section.classList.toggle('open');
  });

  const tracksDiv = document.createElement('div');
  tracksDiv.className = 'lib-project-tracks';
  proj.tracks.forEach(t => tracksDiv.appendChild(buildLibRow(normalizeTrack(t), onTrackClick)));

  section.appendChild(header);
  section.appendChild(tracksDiv);
  return section;
}

// Renders the full project/standalone tree into the given container — used by
// the library modal (full browser) and, historically, the drawer itself
// before it was curated down to 3 rows. onTrackClick lets the modal play
// directly while keeping buildLibRow's gating/unlock/queue logic shared.
export function buildFullLibraryList(targetElId, onTrackClick) {
  const list = el(targetElId);
  const { projects, standalone } = LIBRARY_STRUCTURE;

  if (!projects.length && !standalone.length) {
    list.innerHTML = '<div style="padding:10px 14px;font-family:\'Space Mono\',monospace;font-size:11px;color:rgba(255,255,255,.25);letter-spacing:.06em;">NO UPLOADS YET</div>';
    return;
  }
  list.innerHTML = '';

  for (const proj of projects) {
    list.appendChild(buildLibProjectSection(proj, onTrackClick));
  }

  if (standalone.length) {
    if (projects.length) {
      const sep = document.createElement('div');
      sep.className = 'lib-sep';
      sep.textContent = 'SINGLES';
      list.appendChild(sep);
    }
    standalone.forEach(t => list.appendChild(buildLibRow(normalizeTrack(t), onTrackClick)));
  }
}

function buildCuratedProjectRow(proj, label) {
  const row = document.createElement('div');
  row.className = 'lib-row lib-row-curated';
  const trackCount = proj.tracks.length;
  row.innerHTML = `
    <div class="lib-thumb" style="background:linear-gradient(135deg,#39ff1444,#39ff1411);border:1px solid #39ff1433;"><span>⬡</span></div>
    <div class="lib-info">
      <div class="lib-meta" style="letter-spacing:.12em;color:var(--t3);">${label}</div>
      <div class="lib-title">${esc(proj.name)}</div>
      <div class="lib-meta">${trackCount} track${trackCount !== 1 ? 's' : ''}</div>
    </div>
  `;
  row.addEventListener('click', () => _openLibraryModal());
  return row;
}

// ── Curated drawer (3 rows: latest project, most played, creator highlight) ──
export function buildLibrary() {
  const list = el('lib-list');
  const { curated } = LIBRARY_STRUCTURE;

  list.innerHTML = '';

  if (curated?.recentProject) {
    list.appendChild(buildCuratedProjectRow(curated.recentProject, 'LATEST'));
  }
  if (curated?.mostPlayed) {
    list.appendChild(buildLibRow(normalizeTrack(curated.mostPlayed), () => _openLibraryModal()));
  }
  if (curated?.highlighted?.item) {
    if (curated.highlighted.type === 'project') {
      list.appendChild(buildCuratedProjectRow(curated.highlighted.item, 'FEATURED'));
    } else {
      list.appendChild(buildLibRow(normalizeTrack(curated.highlighted.item), () => _openLibraryModal()));
    }
  }

  if (!list.children.length) {
    list.innerHTML = '<div style="padding:10px 14px;font-family:\'Space Mono\',monospace;font-size:11px;color:rgba(255,255,255,.25);letter-spacing:.06em;">NO UPLOADS YET</div>';
  }
}

// ── Browse (search + genre chips) + discover rows for the library modal ──────

let browseInitialized = false;
let activeGenre = '';
let searchDebounce = null;
let discoverAvailable = false;

export async function loadDiscover() {
  try {
    const d = await api.library.discover();
    const trend = el('library-trending');
    const fresh = el('library-new-releases');
    trend.innerHTML = '';
    fresh.innerHTML = '';
    for (const item of (d.trending || []))    trend.appendChild(buildLibRow(normalizeTrack(item)));
    for (const item of (d.newReleases || [])) fresh.appendChild(buildLibRow(normalizeTrack(item)));
    discoverAvailable = !!((d.trending || []).length || (d.newReleases || []).length);
    el('library-discover').hidden = !discoverAvailable || hasActiveBrowseFilter();
  } catch {
    discoverAvailable = false;
    el('library-discover').hidden = true;
  }
}

function hasActiveBrowseFilter() {
  return !!(el('library-search')?.value.trim() || activeGenre);
}

async function renderBrowseResults() {
  const search = el('library-search').value.trim();

  // No filters: restore the full catalog tree + discover rows.
  if (!search && !activeGenre) {
    el('library-discover').hidden = !discoverAvailable;
    buildFullLibraryList('library-modal-list');
    return;
  }

  el('library-discover').hidden = true;
  try {
    const data = await api.library.list({ search: search || undefined, genre: activeGenre || undefined });
    const list = el('library-modal-list');
    list.innerHTML = '';
    if (!(data.items || []).length) {
      list.innerHTML = '<div style="padding:10px 14px;font-family:\'Space Mono\',monospace;font-size:11px;color:rgba(255,255,255,.25);letter-spacing:.06em;">NO MATCHES</div>';
      return;
    }
    for (const item of data.items) list.appendChild(buildLibRow(normalizeTrack(item)));
  } catch {}
}

export async function initBrowseControls() {
  if (browseInitialized) return;
  browseInitialized = true;

  el('library-search').addEventListener('input', () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(renderBrowseResults, 250);
  });

  try {
    const d = await api.library.genres();
    const chips = el('library-genre-chips');
    const genres = d.genres || [];
    if (!genres.length) { chips.hidden = true; return; }

    chips.innerHTML = '';
    function makeChip(label, value) {
      const btn = document.createElement('button');
      btn.className = 'genre-chip' + (activeGenre === value ? ' active' : '');
      btn.textContent = label;
      btn.addEventListener('click', () => {
        activeGenre = value;
        chips.querySelectorAll('.genre-chip').forEach(c => c.classList.toggle('active', c === btn));
        renderBrowseResults();
      });
      chips.appendChild(btn);
    }
    makeChip('ALL', '');
    for (const g of genres) makeChip(g.genre.toUpperCase(), g.genre);
  } catch {}
}

// Queue drawer (personal + station)
// Relocated here in Phase 8: this rendering logic existed in the original inline
// script (loadQueue) but was not captured by any Phase 5/6/7 module. It belongs
// in library.js because it backs the #queue-drawer content shown by
// player.toggleDrawer('queue'), and player.js injects it via the loadQueue
// callback (registerCallbacks) to avoid a circular import.

export async function loadQueue() {
  try {
    const status = await api.stream.status();
    const list = el('queue-list');
    const personal = listenerQueue.slice(0, 3);
    const stationLimit = listenerQueue.length > 0 ? 3 : 5;
    const station = (Array.isArray(status.stationQueue) ? status.stationQueue : []).slice(0, stationLimit);
    let html = '';

    // Personal queue slots
    html += `<div class="q-stack" data-personal-count="${listenerQueue.length}">`;
    html += `<div class="q-section-row"><div class="q-section">PERSONAL QUEUE</div><span class="q-count">${listenerQueue.length}/5</span></div>`;
    if (personal.length > 0) {
      html += personal.map((t, i) => queueSlot(t, i, true)).join('');
      for (let i = personal.length; i < 3; i++) html += emptyQueueSlot(i, 'Add from library');
    } else {
      html += `<div class="q-empty">Add tracks from the library to build your personal queue.</div>`;
    }

    // Station queue slots
    html += `<hr class="q-divider">`;
    html += `<div class="q-section-row"><div class="q-section">STATION QUEUE</div><span class="q-count">${station.length}/${stationLimit}</span></div>`;
    if (station.length > 0) {
      html += station.map((t, i) => queueSlot(t, i)).join('');
    } else {
      html += `<div class="q-empty">No station tracks queued yet.</div>`;
    }
    html += `</div>`;

    list.innerHTML = html;
  } catch {
    el('queue-list').innerHTML = '';
  }
}

// ── Listener queue ────────────────────────────────────────────────────────────

// removable renders a per-track ✕ (personal queue only — station slots are
// the creator's, not the listener's to remove).
function queueSlot(track, index, removable = false) {
  const title = track?.title || 'Untitled';
  const artist = track?.artist || track?.creator || '';
  const duration = track?.duration ? fmt(track.duration) : '';
  return `<div class="q-row q-slot">
    <span class="q-index">${String(index + 1).padStart(2, '0')}</span>
    <span class="q-track">
      <span class="q-title">${esc(title)}</span>
      ${artist ? `<span class="q-artist">${esc(artist)}</span>` : ''}
    </span>
    ${duration ? `<span class="q-time">${duration}</span>` : ''}
    ${removable ? `<button class="q-remove-btn" data-queue-index="${index}" title="Remove from your queue">✕</button>` : ''}
  </div>`;
}

function emptyQueueSlot(index, label) {
  return `<div class="q-row q-slot q-slot-empty">
    <span class="q-index">${String(index + 1).padStart(2, '0')}</span>
    <span class="q-track"><span class="q-title">${esc(label)}</span></span>
  </div>`;
}

export function updateListenerQueuePill() {
  const pill = el('listener-queue-pill');
  if (!pill) return;
  const count = listenerQueue.length;
  el('lq-count').textContent = count;
  pill.classList.toggle('visible', count > 0);
  if (state.showQueue) loadQueue();
}

export function getListenerQueue() {
  return listenerQueue;
}

// ── Event wiring (called from main.js in Phase 8) ─────────────────────────────

export function initListenerQueueHandlers() {
  // Per-track remove in the personal queue. Delegated because the drawer
  // re-renders its rows on every loadQueue().
  document.addEventListener('click', e => {
    const btn = e.target.closest('.q-remove-btn');
    if (!btn) return;
    e.stopPropagation();
    const index = parseInt(btn.dataset.queueIndex, 10);
    if (Number.isNaN(index) || index < 0 || index >= listenerQueue.length) return;
    const [removed] = listenerQueue.splice(index, 1);
    updateListenerQueuePill();
    showToast(`Removed ${removed?.title || 'track'} (${listenerQueue.length}/5)`);
  });

  document.addEventListener('click', e => {
    const btn = e.target.closest('.lib-queue-btn');
    if (!btn) return;
    if (document.body.classList.contains('dash-active')) return;
    e.stopPropagation();
    if (!authState.loggedIn || authState.tier === 'free') {
      _openModal(); _setModalTab('subscribe');
      return;
    }
    if (listenerQueue.length >= 5) { showToast('Queue full (5/5)'); return; }
    listenerQueue.push({ id: parseInt(btn.dataset.id), title: btn.dataset.title, artist: btn.dataset.artist });
    updateListenerQueuePill();
    showToast(`Added to queue (${listenerQueue.length}/5)`);
  });

  el('listener-queue-pill').addEventListener('click', () => {
    listenerQueue = [];
    updateListenerQueuePill();
    showToast('Queue cleared');
  });
}
