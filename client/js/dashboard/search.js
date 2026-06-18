/**
 * dashboard/search.js — Creator type, radio host status, and external search panel.
 */

import * as api from '../api.js';
import { el, esc, showToast } from '../utils.js';
import { LIBRARY_STRUCTURE } from '../state.js';

// ── Module-local state ─────────────────────────────────────────────────────────
let currentExtPlatform = 'youtube';

// ── Injected callbacks ─────────────────────────────────────────────────────────
let _loadDashLibrary    = () => {};
let _loadDashVaultStats = () => {};

export function init(callbacks = {}) {
  if (callbacks.loadDashLibrary)    _loadDashLibrary    = callbacks.loadDashLibrary;
  if (callbacks.loadDashVaultStats) _loadDashVaultStats = callbacks.loadDashVaultStats;
}

// ── Creator type ───────────────────────────────────────────────────────────────
export async function loadCreatorType() {
  try {
    const data = await api.dashboard.creatorType();
    if (data.creatorType === 'radio_host') {
      document.body.classList.add('radio-host-mode');
      initExtSearchPanel();
      // Auto-expand broadcast advanced section for radio hosts
      const adv = el('broadcast-advanced');
      const tog = el('broadcast-header-toggle');
      if (adv && tog) { adv.classList.add('open'); tog.classList.add('open'); }
    }
  } catch {}
}

// ── Radio host status ──────────────────────────────────────────────────────────
export async function loadRadioHostStatus() {
  try {
    const data = await api.dashboard.radioHostStatus();
    const sw   = el('rh-switch');
    const info = el('rh-switches-info');
    if (!sw) return;
    sw.classList.toggle('on',     data.radioHost);
    sw.classList.toggle('locked', data.locked);
    if (info) {
      info.textContent = data.locked
        ? `Switches used: ${data.switches}/3 — locked. Edit CREATOR_TYPE in .env to change.`
        : `Switches used: ${data.switches}/3`;
    }
  } catch {}
}

// ── External search panel ──────────────────────────────────────────────────────
export function initExtSearchPanel() {
  document.querySelectorAll('.ext-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentExtPlatform = btn.dataset.extPlatform;
      document.querySelectorAll('.ext-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      el('ext-results-list').innerHTML = '';
      el('ext-search-msg').textContent = '';
    });
  });

  el('btn-ext-search').addEventListener('click', runExtSearch);
  el('ext-search-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') runExtSearch();
  });
}

// ── Broadcast-advanced toggle + radio-host switch ──────────────────────────────
// Relocated here in Phase 8: this wiring existed in the original inline script
// but was not captured by any Phase 5/6/7 module. It belongs in search.js
// because it manages the same radio-host-mode state as loadCreatorType() and
// triggers initExtSearchPanel()/loadRadioHostStatus(), both owned here.

export function initRadioHostHandlers() {
  document.addEventListener('click', e => {
    if (e.target.closest('#broadcast-header-toggle')) {
      const adv = el('broadcast-advanced');
      const tog = el('broadcast-header-toggle');
      if (!adv || !tog) return;
      const open = adv.classList.toggle('open');
      tog.classList.toggle('open', open);
      if (open) loadRadioHostStatus();
    }
  });

  document.addEventListener('click', e => {
    const sw = e.target.closest('#rh-switch');
    if (!sw || sw.classList.contains('locked')) return;
    api.dashboard.toggleRadioHost()
      .then(data => {
        if (data.error) { showToast(data.error); return; }
        sw.classList.toggle('on', data.radioHost);
        sw.classList.toggle('locked', data.locked);
        const info = el('rh-switches-info');
        if (info) {
          info.textContent = data.locked
            ? `Switches used: ${data.switches}/3 — locked. Edit CREATOR_TYPE in .env to change.`
            : `Switches used: ${data.switches}/3`;
        }
        if (data.radioHost) {
          document.body.classList.add('radio-host-mode');
          initExtSearchPanel();
        } else {
          document.body.classList.remove('radio-host-mode');
        }
        showToast(data.radioHost ? 'Radio Host mode ON' : 'Radio Host mode OFF');
      })
      .catch(() => showToast('Toggle failed'));
  });
}

async function runExtSearch() {
  const q    = el('ext-search-input').value.trim();
  const msg  = el('ext-search-msg');
  const list = el('ext-results-list');
  if (!q) return;
  msg.textContent = 'Searching…';
  list.innerHTML  = '';

  try {
    if (currentExtPlatform === 'library') {
      const allTracks = [
        ...(LIBRARY_STRUCTURE.standalone || []),
        ...(LIBRARY_STRUCTURE.projects || []).flatMap(p => p.items || []),
      ];
      const lq      = q.toLowerCase();
      const results = allTracks.filter(t =>
        (t.title || '').toLowerCase().includes(lq) ||
        (t.artist || '').toLowerCase().includes(lq)
      ).slice(0, 20);
      msg.textContent = results.length ? '' : 'No matches in station library.';
      renderExtResults(results.map(t => ({
        id:          String(t.id),
        title:       t.title || t.filename || '',
        artist:      t.artist || '',
        thumbnail:   '',
        duration:    t.duration || null,
        externalUrl: null,
        platform:    'library',
        libraryId:   t.id,
      })));
    } else {
      const r = await api.dashboard.externalSearch(currentExtPlatform, q);
      if (!r.items || !r.items.length) {
        msg.textContent = r.items ? 'No results found.' : 'API key not configured for this platform.';
        return;
      }
      msg.textContent = '';
      renderExtResults(r.items);
    }
  } catch {
    msg.textContent = 'Search failed.';
  }
}

function renderExtResults(items) {
  const list = el('ext-results-list');
  list.innerHTML = '';
  items.forEach(item => {
    const div = document.createElement('div');
    div.className = 'ext-result-item';
    const dur = item.duration ? fmtDuration(item.duration) : '';
    div.innerHTML = `
      ${item.thumbnail ? `<img src="${esc(item.thumbnail)}" alt="" loading="lazy"/>` : `<div style="width:36px;height:36px;background:rgba(255,255,255,.06);border-radius:3px;flex-shrink:0;"></div>`}
      <div class="ext-result-meta">
        <div class="ext-result-title">${esc(item.title)}</div>
        <div class="ext-result-artist">${esc(item.artist || '')}</div>
      </div>
      ${dur ? `<div class="ext-result-dur">${esc(dur)}</div>` : ''}
    `;
    if (item.platform !== 'library') {
      const addBtn = document.createElement('button');
      addBtn.className   = 'mgmt-btn';
      addBtn.textContent = 'ADD';
      addBtn.addEventListener('click', async () => {
        addBtn.textContent = '…';
        addBtn.disabled    = true;
        const ok = await addExternalTrack(item);
        addBtn.textContent = ok ? 'ADDED' : 'FAIL';
        if (ok) addBtn.style.color = '#39ff14';
      });
      div.appendChild(addBtn);
    }
    list.appendChild(div);
  });
}

async function addExternalTrack(item) {
  try {
    const { res } = await api.dashboard.media.importExternal({
      title:       item.title,
      artist:      item.artist || '',
      platform:    item.platform,
      externalUrl: item.externalUrl,
      duration:    item.duration || null,
    });
    if (!res.ok) return false;
    _loadDashLibrary();
    _loadDashVaultStats();
    return true;
  } catch {
    return false;
  }
}

function fmtDuration(secs) {
  if (!secs) return '';
  const m = Math.floor(secs / 60);
  const s = String(Math.floor(secs % 60)).padStart(2, '0');
  return `${m}:${s}`;
}
