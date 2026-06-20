/**
 * dashboard/share.js - Private share link management.
 */

import * as api from '../api.js';
import { el, esc } from '../utils.js';

let _loadDashLibrary = () => {};
let _loadDashProjects = () => {};

const shareTargets = { track: [], project: [] };
let targetsLoaded = false;
let selectedTarget = null;

export function init(callbacks = {}) {
  if (callbacks.loadDashLibrary)  _loadDashLibrary  = callbacks.loadDashLibrary;
  if (callbacks.loadDashProjects) _loadDashProjects = callbacks.loadDashProjects;
}

function shareUrl(token) {
  return `${window.location.origin}/share/${token}`;
}

function fmtDate(iso) {
  if (!iso) return 'never';
  try {
    const normalized = String(iso).includes('T') ? iso : String(iso).replace(' ', 'T') + 'Z';
    return new Date(normalized).toLocaleString();
  } catch {
    return iso;
  }
}

function fmtTargetType(type) {
  return type === 'project' ? 'Collection' : 'Track';
}

function targetIcon(type) {
  return type === 'project' ? '▦' : '♪';
}

async function loadShareTargets() {
  if (targetsLoaded) return;
  const [items, pricing] = await Promise.all([
    api.dashboard.media.list(),
    api.dashboard.vault.pricing(),
  ]);
  shareTargets.track = (items || []).map(item => ({
    type: 'track',
    id: item.id,
    name: item.title || item.filename || `Track #${item.id}`,
    meta: [item.artist, item.category].filter(Boolean).join(' / '),
  }));
  shareTargets.project = (pricing.projects || []).map(project => ({
    type: 'project',
    id: project.id,
    name: project.name || `Collection #${project.id}`,
    meta: `${(project.items || []).length} track${(project.items || []).length === 1 ? '' : 's'}`,
  }));
  targetsLoaded = true;
}

function setSelectedTarget(target) {
  selectedTarget = target;
  const idEl = el('new-share-target-id');
  const searchEl = el('new-share-target-search');
  const selectedEl = el('new-share-target-selected');
  if (idEl) idEl.value = target ? String(target.id) : '';
  if (searchEl && target) searchEl.value = target.name;
  if (selectedEl) {
    selectedEl.textContent = target
      ? `${fmtTargetType(target.type)} selected: ${target.name}`
      : 'No target selected.';
  }
  renderShareTargetOptions();
}

function currentTargetType() {
  return el('new-share-target-type')?.value || 'track';
}

function renderShareTargetOptions() {
  const results = el('new-share-target-results');
  if (!results) return;
  const type = currentTargetType();
  const search = (el('new-share-target-search')?.value || '').trim().toLowerCase();
  const matches = (shareTargets[type] || [])
    .filter(target => {
      if (!search || selectedTarget?.id === target.id && selectedTarget?.type === target.type) return true;
      return `${target.name} ${target.meta}`.toLowerCase().includes(search);
    })
    .slice(0, 8);

  if (!targetsLoaded) {
    results.innerHTML = '<div class="share-target-selected">Loading targets...</div>';
    return;
  }
  if (!matches.length) {
    results.innerHTML = '<div class="share-target-selected">No matching targets.</div>';
    return;
  }

  results.innerHTML = matches.map(target => `
    <button class="share-target-option${selectedTarget?.type === target.type && selectedTarget?.id === target.id ? ' active' : ''}" type="button" data-share-target="${target.type}:${target.id}">
      <span class="share-target-kind">${targetIcon(target.type)}</span>
      <span class="share-target-name">${esc(target.name)}</span>
      <span class="share-target-kind">${esc(target.meta || fmtTargetType(target.type))}</span>
    </button>
  `).join('');

  results.querySelectorAll('[data-share-target]').forEach(btn => {
    btn.addEventListener('click', () => {
      const [targetType, rawId] = btn.dataset.shareTarget.split(':');
      const target = (shareTargets[targetType] || []).find(item => item.id === parseInt(rawId, 10));
      if (target) setSelectedTarget(target);
    });
  });
}

async function ensureTargetPicker() {
  const searchEl = el('new-share-target-search');
  if (!searchEl) return;
  try {
    await loadShareTargets();
    renderShareTargetOptions();
  } catch {
    const results = el('new-share-target-results');
    if (results) results.innerHTML = '<div class="share-target-selected" style="color:#ff6b6b;">Failed to load targets.</div>';
  }
}

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
    const table = document.createElement('div');
    table.className = 'share-table';
    for (const link of links) table.appendChild(buildShareLinkRow(link));
    list.appendChild(table);
  } catch {
    list.innerHTML = '<div style="font-size:11px;color:#ff6b6b;font-family:\'Space Mono\',monospace;padding:4px 14px;">Failed to load share links.</div>';
  }
}

function buildShareLinkRow(link) {
  const row = document.createElement('div');
  row.className = 'share-table-row';
  const expired = link.expires_at && new Date(String(link.expires_at).replace(' ', 'T') + 'Z').getTime() < Date.now();
  const title = link.label || link.target_label || `${fmtTargetType(link.target_type)} #${link.target_id}`;
  row.innerHTML = `
    <div class="share-table-main">
      <span class="share-target-kind">${targetIcon(link.target_type)}</span>
      <span class="share-table-title">${esc(title)}</span>
      <div class="share-table-actions">
        <button class="mgmt-btn" data-open-share="${esc(link.token)}">OPEN</button>
        <button class="mgmt-btn" data-copy-share="${esc(link.token)}">COPY</button>
        <button class="mgmt-btn danger" data-del-share="${esc(link.token)}">REVOKE</button>
      </div>
    </div>
    <div class="share-table-meta">
      ${fmtTargetType(link.target_type)}${link.target_label ? ': ' + esc(link.target_label) : ''} / created ${esc(fmtDate(link.created_at))} / expires ${esc(fmtDate(link.expires_at))} / ${Number(link.open_count || 0)} opens / last opened ${esc(fmtDate(link.last_opened_at))}${expired ? ' / expired' : ''}
    </div>
  `;

  row.querySelector('[data-open-share]').addEventListener('click', () => {
    window.open(shareUrl(link.token), '_blank', 'noopener');
  });

  row.querySelector('[data-copy-share]').addEventListener('click', async () => {
    const btn = row.querySelector('[data-copy-share]');
    try {
      await navigator.clipboard.writeText(shareUrl(link.token));
      btn.textContent = 'COPIED';
      setTimeout(() => { btn.textContent = 'COPY'; }, 1500);
    } catch {}
  });

  row.querySelector('[data-del-share]').addEventListener('click', async () => {
    if (!confirm('Revoke this share link? It will stop working immediately.')) return;
    await api.dashboard.share.remove(link.token);
    loadDashShareLinks();
  });

  return row;
}

export function initShareLinkHandlers() {
  const btn = el('btn-new-share');
  const searchEl = el('new-share-target-search');
  const typeEl = el('new-share-target-type');
  if (!btn) return;

  ensureTargetPicker();

  if (searchEl) {
    searchEl.addEventListener('focus', ensureTargetPicker);
    searchEl.addEventListener('input', () => {
      if (selectedTarget && searchEl.value !== selectedTarget.name) setSelectedTarget(null);
      renderShareTargetOptions();
    });
  }

  if (typeEl) {
    typeEl.addEventListener('change', () => {
      setSelectedTarget(null);
      ensureTargetPicker();
    });
  }

  btn.addEventListener('click', async () => {
    const msgEl = el('new-share-msg');
    const targetType = currentTargetType();
    const targetId = parseInt(el('new-share-target-id').value, 10);
    const label = el('new-share-label').value.trim();
    const expiresHours = el('new-share-expires').value;

    if (!Number.isInteger(targetId)) {
      msgEl.style.color = '#ff6b6b';
      msgEl.textContent = 'Select a track or collection';
      return;
    }

    msgEl.style.color = 'rgba(255,255,255,.4)';
    msgEl.textContent = 'Creating...';

    const { res, data } = await api.dashboard.share.create({
      target_type: targetType,
      target_id: targetId,
      label: label || null,
      expires_in_hours: expiresHours ? parseFloat(expiresHours) : null,
    });

    if (res.ok) {
      el('new-share-label').value = '';
      el('new-share-expires').value = '';
      if (searchEl) searchEl.value = '';
      setSelectedTarget(null);
      msgEl.style.color = 'rgba(255,255,255,.45)';
      msgEl.textContent = data.url ? 'Created. Link is ready to copy below.' : '';
      loadDashShareLinks();
      _loadDashLibrary();
      _loadDashProjects();
    } else {
      msgEl.style.color = '#ff6b6b';
      msgEl.textContent = data.error || 'Error creating share link';
    }
  });
}
