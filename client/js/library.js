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

/**
 * Register cross-module callbacks.
 * Called from main.js in Phase 8.
 *
 * @param {{ selectVOD, startGatedPreview, openModal, setModalTab }} cbs
 */
export function init({ selectVOD, startGatedPreview, openModal, setModalTab } = {}) {
  if (selectVOD)         _selectVOD         = selectVOD;
  if (startGatedPreview) _startGatedPreview  = startGatedPreview;
  if (openModal)         _openModal          = openModal;
  if (setModalTab)       _setModalTab        = setModalTab;
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
    isLive:     false,
    artworkUrl: item.artwork_url || null,
    waveform:   generateWaveform(item.id),
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

export function buildLibRow(t) {
  const row = document.createElement('div');
  row.className = 'lib-row';
  const isActive = state.track && state.track.id === t.id;
  if (isActive) { row.classList.add('active'); row.style.borderLeftColor = t.color; }
  const isGated = t.visibility === 'supporters_only' || t.visibility === 'vault';
  const thumbContent = t.artworkUrl
    ? `<img src="/api/library/${t.id}/artwork" loading="lazy" onerror="this.style.display='none'"/>`
    : `<span>${t.type === 'video' ? '▶' : '♪'}</span>`;
  row.innerHTML = `
    <div class="lib-thumb" style="background:linear-gradient(135deg,${t.color}44,${t.color}11);border:1px solid ${t.color}33;">${thumbContent}<button class="lib-queue-btn" data-id="${t.id}" data-title="${esc(t.title)}" data-artist="${esc(t.creator)}" title="Add to queue">+</button></div>
    <div class="lib-info">
      <div class="lib-title${isActive ? ' active' : ''}">
        ${esc(t.title)}${isGated ? '<span class="lib-lock">⬡</span>' : ''}
      </div>
      <div class="lib-meta">${t.date}${t.date && t.duration ? ' · ' : ''}${t.duration ? fmt(t.duration) : ''}</div>
    </div>
    <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
      <span class="type-badge" style="background:${t.color};font-size:11px;padding:2px 6px;">${t.type === 'video' ? '● VIDEO' : '◉ AUDIO'}</span>
      ${isGated ? '<button class="lib-dollar-btn" title="Support to unlock">$</button>' : ''}
    </div>
  `;
  if (isGated) {
    row.querySelector('.lib-dollar-btn').addEventListener('click', e => {
      e.stopPropagation();
      _openModal(); _setModalTab('subscribe');
    });
  }
  row.addEventListener('click', () => _selectVOD(t));
  return row;
}

export function buildLibrary() {
  const list = el('lib-list');
  const { projects, standalone } = LIBRARY_STRUCTURE;

  if (!projects.length && !standalone.length) {
    list.innerHTML = '<div style="padding:10px 14px;font-family:\'Space Mono\',monospace;font-size:11px;color:rgba(255,255,255,.25);letter-spacing:.06em;">NO UPLOADS YET</div>';
    return;
  }
  list.innerHTML = '';

  for (const proj of projects) {
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
    proj.tracks.forEach(t => tracksDiv.appendChild(buildLibRow(normalizeTrack(t))));

    section.appendChild(header);
    section.appendChild(tracksDiv);
    list.appendChild(section);
  }

  if (standalone.length) {
    if (projects.length) {
      const sep = document.createElement('div');
      sep.className = 'lib-sep';
      sep.textContent = 'SINGLES';
      list.appendChild(sep);
    }
    standalone.forEach(t => list.appendChild(buildLibRow(normalizeTrack(t))));
  }
}

// ── Queue drawer (scheduled next + recently played) ───────────────────────────
// Relocated here in Phase 8: this rendering logic existed in the original inline
// script (loadQueue) but was not captured by any Phase 5/6/7 module. It belongs
// in library.js because it backs the #queue-drawer content shown by
// player.toggleDrawer('queue'), and player.js injects it via the loadQueue
// callback (registerCallbacks) to avoid a circular import.

export async function loadQueue() {
  try {
    const [block, status] = await Promise.all([
      api.library.scheduleCurrent(),
      api.stream.status(),
    ]);
    const list   = el('queue-list');
    const recent = Array.isArray(status.recentlyPlayed) ? status.recentlyPlayed : [];
    let html = '';

    // ── Scheduled next ──
    html += `<div class="q-section">SCHEDULED NEXT</div>`;
    if (block) {
      html += `<div class="q-row">
        <span class="q-title">${esc(block.label || 'Broadcast')}</span>
        <span class="q-time">${block.start_time || ''}${block.end_time ? ' – ' + block.end_time : ''}</span>
      </div>`;
    } else {
      html += `<div class="q-row"><span class="q-title" style="opacity:.3;font-size:13px;">No schedule active</span></div>`;
    }

    // ── Recently played ──
    if (recent.length > 0) {
      html += `<hr class="q-divider"><div class="q-section">RECENTLY PLAYED</div>`;
      for (const t of recent) {
        html += `<div class="q-row">
          <span class="q-title">${esc(t.title)}</span>
          ${t.artist ? `<span class="q-time">${esc(t.artist)}</span>` : ''}
        </div>`;
      }
    }

    list.innerHTML = html;
  } catch {
    el('queue-list').innerHTML = '';
  }
}

// ── Listener queue ────────────────────────────────────────────────────────────

export function updateListenerQueuePill() {
  const pill = el('listener-queue-pill');
  if (!pill) return;
  const count = listenerQueue.length;
  el('lq-count').textContent = count;
  pill.classList.toggle('visible', count > 0);
}

export function getListenerQueue() {
  return listenerQueue;
}

// ── Event wiring (called from main.js in Phase 8) ─────────────────────────────

export function initListenerQueueHandlers() {
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
