/**
 * collection.js — "Your Collection" + purchase history in the account panel.
 *
 * Renders everything the listener owns (vault unlocks resolved server-side by
 * GET /api/listener/collection) plus their purchase history, and offers local
 * saves (offline.js) on tracks the creator marked offline_allowed.
 *
 * Callbacks injected via init():
 *   selectVOD — from player.js, plays a track in the main player
 */

import { authState } from './state.js';
import { el, esc, fmt } from './utils.js';
import * as api from './api.js';
import * as offline from './offline.js';

let _selectVOD = () => {};
let _normalizeTrack = t => t;

export function init({ selectVOD, normalizeTrack } = {}) {
  if (selectVOD)      _selectVOD      = selectVOD;
  if (normalizeTrack) _normalizeTrack = normalizeTrack;
}

/**
 * Load and render the collection block inside the account panel.
 * Safe to call whenever auth state changes; hides itself when logged out.
 */
export async function loadCollection() {
  const section = el('collection-section');
  if (!section) return;

  if (!authState.loggedIn) {
    section.hidden = true;
    return;
  }

  let items = [];
  let purchases = [];
  try {
    const [col, pur] = await Promise.all([
      api.auth.collection().catch(() => ({ items: [] })),
      api.auth.purchases().catch(() => ({ purchases: [] })),
    ]);
    items = col.items || [];
    purchases = pur.purchases || [];
  } catch {}

  const saved = await offline.savedIds();
  const list = el('collection-list');
  section.hidden = false;

  if (!items.length) {
    list.innerHTML = '<div class="collection-empty">Nothing unlocked yet — anything you buy or unlock appears here.</div>';
  } else {
    list.innerHTML = '';
    for (const item of items) {
      list.appendChild(buildCollectionRow(item, saved.has(item.id)));
    }
  }

  const purchasesEl = el('collection-purchases');
  if (!purchases.length) {
    purchasesEl.innerHTML = '';
    purchasesEl.hidden = true;
  } else {
    purchasesEl.hidden = false;
    purchasesEl.innerHTML = '<div class="collection-sub-label">PURCHASE HISTORY</div>' + purchases.map(p => `
      <div class="collection-purchase-row">
        <span class="cp-title">${esc(p.title || p.unlockType)}</span>
        <span class="cp-amount">${p.amountPaidCents ? '$' + (p.amountPaidCents / 100).toFixed(2) : 'FREE'}</span>
        <span class="cp-date">${p.createdAt ? new Date(p.createdAt + 'Z').toLocaleDateString() : ''}</span>
      </div>`).join('');
  }
}

function buildCollectionRow(item, isSaved) {
  const row = document.createElement('div');
  row.className = 'collection-row';
  row.innerHTML = `
    <div class="collection-row-info">
      <div class="collection-row-title">${esc(item.title)}</div>
      <div class="collection-row-meta">${item.duration ? fmt(item.duration) : ''}${item.genre ? ' · ' + esc(item.genre) : ''}</div>
    </div>
    <div class="collection-row-actions">
      <button class="mgmt-btn col-play-btn">PLAY</button>
      ${item.offlineAllowed ? `<button class="mgmt-btn col-save-btn">${isSaved ? '✓ SAVED' : '↓ SAVE'}</button>` : ''}
    </div>`;

  row.querySelector('.col-play-btn').addEventListener('click', async () => {
    // Prefer the saved local copy when one exists (works offline).
    if (isSaved && await offline.playSaved(item.id)) return;
    _selectVOD(_normalizeTrack(item));
  });

  const saveBtn = row.querySelector('.col-save-btn');
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      if (isSaved) {
        await offline.removeSaved(item.id);
        isSaved = false;
        saveBtn.textContent = '↓ SAVE';
        return;
      }
      saveBtn.disabled = true;
      saveBtn.textContent = '…';
      const ok = await offline.saveTrack(item);
      isSaved = ok;
      saveBtn.disabled = false;
      saveBtn.textContent = ok ? '✓ SAVED' : '↓ SAVE';
    });
  }

  return row;
}
