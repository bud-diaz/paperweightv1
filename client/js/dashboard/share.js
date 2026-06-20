/**
 * dashboard/share.js — Private share link management.
 */

import * as api from '../api.js';
import { el, esc } from '../utils.js';

// ── Injected callbacks ─────────────────────────────────────────────────────────
let _loadDashLibrary = () => {};
let _loadDashProjects = () => {};

export function init(callbacks = {}) {
  if (callbacks.loadDashLibrary)  _loadDashLibrary  = callbacks.loadDashLibrary;
  if (callbacks.loadDashProjects) _loadDashProjects = callbacks.loadDashProjects;
}

function shareUrl(token) {
  return `${window.location.origin}/api/share/${token}`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso.replace(' ', 'T') + 'Z').toLocaleString(); } catch { return iso; }
}

// ── Share link list ──────────────────────────────────────────────────────────
export async function loadDashShareLinks() {
  const list = el('dash-share-list');
  if (!list) return;
  try {
    const links = await api.dashboard.share.list();
    list.innerHTML = '';
    if (!links.length) {
      list.innerHTML = '<div style="font-size:11px;color:rgba(255,255,255,.25);font-family:\'Space Mono\',monospace;padding:4px 14px 8px;">No share links yet.</div>';
      return;
    }
    for (const link of links) list.appendChild(buildShareLinkRow(link));
  } catch {
    list.innerHTML = '<div style="font-size:11px;color:#ff6b6b;font-family:\'Space Mono\',monospace;padding:4px 14px;">Failed to load share links.</div>';
  }
}

function buildShareLinkRow(link) {
  const row = document.createElement('div');
  row.className = 'dash-proj-track-row';
  const expired = link.expires_at && new Date(link.expires_at).getTime() < Date.now();
  row.innerHTML = `
    <span style="font-size:11px;color:rgba(255,255,255,.25);flex-shrink:0;">${link.target_type === 'project' ? '▶' : '♪'}</span>
    <span class="dash-proj-track-title">${esc(link.label || link.target_label || `#${link.target_id}`)}</span>
    <span class="dash-proj-track-artist">${link.open_count} open${link.open_count !== 1 ? 's' : ''}${expired ? ' — expired' : ''}</span>
    <button class="mgmt-btn" data-copy="${esc(link.token)}" style="flex-shrink:0;">COPY LINK</button>
    <button class="mgmt-btn danger" data-del-share="${esc(link.token)}" style="flex-shrink:0;">DELETE</button>
  `;

  row.querySelector('[data-copy]').addEventListener('click', async () => {
    const btn = row.querySelector('[data-copy]');
    try {
      await navigator.clipboard.writeText(shareUrl(link.token));
      btn.textContent = 'COPIED';
      setTimeout(() => { btn.textContent = 'COPY LINK'; }, 1500);
    } catch {}
  });

  row.querySelector('[data-del-share]').addEventListener('click', async () => {
    if (!confirm('Delete this share link? It will stop working immediately.')) return;
    await api.dashboard.share.remove(link.token);
    loadDashShareLinks();
  });

  return row;
}

// ── Creation handler ──────────────────────────────────────────────────────────
export function initShareLinkHandlers() {
  const btn = el('btn-new-share');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    const msgEl       = el('new-share-msg');
    const targetType  = el('new-share-target-type').value;
    const targetId    = parseInt(el('new-share-target-id').value, 10);
    const label       = el('new-share-label').value.trim();
    const expiresHours = el('new-share-expires').value;

    if (!Number.isInteger(targetId)) {
      msgEl.style.color = '#ff6b6b';
      msgEl.textContent = 'Select a track or project';
      return;
    }

    msgEl.style.color = 'rgba(255,255,255,.4)';
    msgEl.textContent = 'Creating…';

    const { res } = await api.dashboard.share.create({
      target_type: targetType,
      target_id: targetId,
      label: label || null,
      expires_in_hours: expiresHours ? parseFloat(expiresHours) : null,
    });

    if (res.ok) {
      el('new-share-label').value = '';
      el('new-share-expires').value = '';
      msgEl.textContent = '';
      loadDashShareLinks();
    } else {
      msgEl.style.color = '#ff6b6b';
      msgEl.textContent = 'Error creating share link';
    }
  });
}
