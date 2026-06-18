/**
 * dashboard/broadcast.js — Broadcast status, queue, and mode management.
 */

import * as api from '../api.js';
import { el, esc, showToast } from '../utils.js';

export function init() {}

export async function loadDashBroadcast() {
  try {
    const data = await api.stream.status();
    const np   = data.nowPlaying;
    el('dash-np').textContent   = np ? (np.title + (np.artist ? ' — ' + np.artist : '')) : 'Nothing playing';
    el('dash-mode').textContent = (data.mode || 'shuffle').toUpperCase();

    el('btn-toggle-mode').textContent = data.mode === 'shuffle' ? 'SWITCH TO SCHEDULED' : 'SWITCH TO SHUFFLE';
    el('btn-toggle-mode').onclick = async () => {
      const newMode = data.mode === 'shuffle' ? 'scheduled' : 'shuffle';
      await api.dashboard.broadcast.setMode(newMode);
      loadDashBroadcast();
    };
    el('btn-restart').onclick = async () => {
      el('btn-restart').textContent = 'RESTARTING…';
      await api.dashboard.broadcast.restart();
      setTimeout(() => { el('btn-restart').textContent = 'RESTART'; loadDashBroadcast(); }, 1500);
    };
  } catch {}
  loadDashBroadcastQueue();
}

export async function loadDashBroadcastQueue() {
  try {
    const { queue: q } = await api.dashboard.broadcast.getQueue();
    const list = el('sq-list');
    if (!list) return;
    if (!q || !q.length) {
      list.innerHTML = '<div class="sq-empty">Queue is empty — add tracks from the library below.</div>';
      return;
    }
    list.innerHTML = q.map((item, i) => `
      <div class="sq-item">
        <span class="sq-title">${esc(item.title || 'Track ' + item.mediaId)}</span>
        <button class="sq-remove mgmt-btn danger" data-sq-idx="${i}" title="Remove">×</button>
      </div>`).join('');
    list.querySelectorAll('[data-sq-idx]').forEach(btn => {
      btn.addEventListener('click', async () => {
        await api.dashboard.broadcast.removeFromQueue(btn.dataset.sqIdx);
        loadDashBroadcastQueue();
      });
    });
  } catch {}
}

export function initBroadcastHandlers() {
  // Station queue button (dashboard context)
  document.addEventListener('click', e => {
    const btn = e.target.closest('.lib-queue-btn');
    if (!btn) return;
    if (!document.body.classList.contains('dash-active')) return;
    e.stopPropagation();
    api.dashboard.broadcast.enqueue(parseInt(btn.dataset.id)).then(({ data }) => {
      if (data.error) { showToast(data.error); return; }
      showToast(`Queued for broadcast (${data.count}/5)`);
      loadDashBroadcastQueue();
    }).catch(() => showToast('Queue error'));
  });
}
