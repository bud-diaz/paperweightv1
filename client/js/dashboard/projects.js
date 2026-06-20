/**
 * dashboard/projects.js — Vault project management.
 */

import * as api from '../api.js';
import { el, esc } from '../utils.js';
import { toggleHighlight } from './vault.js';

// ── Injected callbacks ─────────────────────────────────────────────────────────
let _loadDashProjects  = () => {};
let _loadDashLibrary   = () => {};
let _loadDashVaultStats = () => {};

export function init(callbacks = {}) {
  if (callbacks.loadDashProjects)   _loadDashProjects   = callbacks.loadDashProjects;
  if (callbacks.loadDashLibrary)    _loadDashLibrary    = callbacks.loadDashLibrary;
  if (callbacks.loadDashVaultStats) _loadDashVaultStats = callbacks.loadDashVaultStats;
}

// ── Project list ───────────────────────────────────────────────────────────────
export async function loadDashProjects() {
  try {
    const [items, pricing, highlight] = await Promise.all([
      api.dashboard.media.list(),
      api.dashboard.vault.pricing(),
      api.dashboard.vault.getHighlight(),
    ]);
    const projects    = pricing.projects || [];
    const assignedIds = new Set(projects.flatMap(p => (p.items||[]).map(i => i.content_id)));
    const unassigned  = items.filter(it => !assignedIds.has(it.id));
    const list        = el('dash-proj-list');
    list.innerHTML    = '';
    if (!projects.length) {
      list.innerHTML = '<div style="font-size:11px;color:rgba(255,255,255,.25);font-family:\'Space Mono\',monospace;padding:4px 14px 8px;">No projects yet.</div>';
    }
    for (const proj of projects) list.appendChild(buildDashProjectCard(proj, items, unassigned, highlight));
  } catch {
    el('dash-proj-list').innerHTML = '<div style="font-size:11px;color:#ff6b6b;font-family:\'Space Mono\',monospace;padding:4px 14px;">Failed to load projects.</div>';
  }
}

// ── Project card builder ───────────────────────────────────────────────────────
export function buildDashProjectCard(proj, allItems, unassigned, highlight = null) {
  const card = document.createElement('div');
  card.className = 'dash-proj-card';

  const isHighlighted = highlight?.highlight_type === 'project' && highlight?.highlight_id === proj.id;

  // Header
  const head = document.createElement('div');
  head.className = 'dash-proj-head';
  head.innerHTML = `
    <span class="dash-proj-chevron">▶</span>
    <span class="dash-proj-title">${esc(proj.name)}</span>
    <span class="dash-proj-count">${(proj.items||[]).length} track${(proj.items||[]).length!==1?'s':''}</span>
    <button class="mgmt-btn${isHighlighted ? ' active' : ''}" id="hl-tog-project-${proj.id}" data-highlighted="${isHighlighted ? '1' : '0'}" style="flex-shrink:0;">${isHighlighted ? '★ HIGHLIGHTED' : '☆ HIGHLIGHT'}</button>
    <button class="mgmt-btn danger" data-del="${proj.id}" style="flex-shrink:0;">DELETE</button>
  `;
  card.appendChild(head);

  head.querySelector(`#hl-tog-project-${proj.id}`).addEventListener('click', e => {
    e.stopPropagation();
    toggleHighlight(head.querySelector(`#hl-tog-project-${proj.id}`), 'project', proj.id);
  });

  // Body (hidden initially)
  const body = document.createElement('div');
  body.className = 'dash-proj-body';
  body.hidden = true;
  card.appendChild(body);

  // Track list
  const tracks = proj.items || [];
  if (tracks.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:6px 14px;font-family:\'Space Mono\',monospace;font-size:10px;color:rgba(255,255,255,.2);';
    empty.textContent = 'No tracks in this project.';
    body.appendChild(empty);
  } else {
    for (const t of tracks) {
      const mediaItem = allItems.find(i => i.id === t.content_id) || {};
      const row = document.createElement('div');
      row.className = 'dash-proj-track-row';
      row.innerHTML = `
        <span style="font-size:11px;color:rgba(255,255,255,.25);flex-shrink:0;">${mediaItem.category==='videos'?'▶':'♪'}</span>
        <span class="dash-proj-track-title">${esc(t.title || mediaItem.title || mediaItem.filename || '')}</span>
        ${mediaItem.artist ? `<span class="dash-proj-track-artist">${esc(mediaItem.artist)}</span>` : ''}
        <button class="mgmt-btn danger" data-remove-track="${t.content_id}" style="flex-shrink:0;">REMOVE</button>
      `;
      body.appendChild(row);
    }
  }

  // Add track row
  const addRow = document.createElement('div');
  addRow.style.cssText = 'display:flex;align-items:center;gap:6px;padding:6px 14px 8px;border-top:1px solid rgba(255,255,255,.06);';
  const addSel = document.createElement('select');
  addSel.className = 'dash-select';
  addSel.id = `padd-sel-${proj.id}`;
  addSel.style.flex = '1';
  if (unassigned.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '— no unassigned tracks —';
    addSel.appendChild(opt);
  } else {
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '— add a track —';
    addSel.appendChild(placeholder);
    for (const it of unassigned) {
      const opt = document.createElement('option');
      opt.value = it.id;
      opt.textContent = it.title || it.filename || `#${it.id}`;
      if (it.artist) opt.textContent += ` — ${it.artist}`;
      addSel.appendChild(opt);
    }
  }
  const addBtn = document.createElement('button');
  addBtn.className = 'mgmt-btn';
  addBtn.id = `padd-btn-${proj.id}`;
  addBtn.textContent = 'ADD';
  const addMsg = document.createElement('span');
  addMsg.id = `padd-msg-${proj.id}`;
  addMsg.style.cssText = 'font-family:\'Space Mono\',monospace;font-size:10px;';
  addRow.appendChild(addSel);
  addRow.appendChild(addBtn);
  addRow.appendChild(addMsg);
  body.appendChild(addRow);

  // Pricing / edit section
  const pricingDiv = document.createElement('div');
  pricingDiv.className = 'dash-proj-pricing';
  const suggestedDollars = proj.suggested_price != null ? (proj.suggested_price / 100).toFixed(2) : '';
  const minimumDollars   = proj.minimum_price   != null ? (proj.minimum_price   / 100).toFixed(2) : '';
  pricingDiv.innerHTML = `
    <div class="dash-edit-label">NAME</div>
    <input class="dash-input" id="pprice-name-${proj.id}" type="text" value="${esc(proj.name)}" style="margin-bottom:6px;"/>
    <div class="dash-edit-label">DESCRIPTION</div>
    <textarea class="dash-input" id="pprice-desc-${proj.id}" style="margin-bottom:6px;">${esc(proj.description||'')}</textarea>
    <div class="dash-edit-label">PRICING</div>
    <div class="dash-proj-price-grid">
      <div>
        <div class="dash-edit-label">SUGGESTED ($)</div>
        <input class="dash-input-sm" id="pprice-sugg-${proj.id}" type="number" step="0.01" min="0" value="${suggestedDollars}"/>
      </div>
      <div>
        <div class="dash-edit-label">MINIMUM ($)</div>
        <input class="dash-input-sm" id="pprice-min-${proj.id}" type="number" step="0.01" min="0" value="${minimumDollars}"/>
      </div>
    </div>
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:10px;">
      <input type="checkbox" id="pprice-free-${proj.id}"${proj.allow_free?' checked':''}/>
      <label for="pprice-free-${proj.id}" style="font-family:'Space Mono',monospace;font-size:10px;color:rgba(255,255,255,.4);cursor:pointer;">Allow free / pay-what-you-want</label>
    </div>
    <div class="dash-form-row">
      <span id="pprice-msg-${proj.id}" style="font-family:'Space Mono',monospace;font-size:10px;flex:1;"></span>
      <button class="mgmt-btn" id="pprice-save-${proj.id}">SAVE PRICING</button>
    </div>
  `;
  body.appendChild(pricingDiv);

  // ── Event listeners ──────────────────────────────────────────────────────

  // Header click: toggle body (but not DELETE)
  head.addEventListener('click', e => {
    if (e.target.closest('[data-del]') || e.target.closest('[id^="hl-tog-project-"]')) return;
    const open = body.hidden;
    body.hidden = !open;
    if (open) head.classList.add('open'); else head.classList.remove('open');
  });

  // DELETE project
  head.querySelector('[data-del]').addEventListener('click', async () => {
    if (!confirm(`Delete project "${proj.name}"? Tracks will be unassigned, not deleted.`)) return;
    await api.dashboard.vault.deleteProject(proj.id);
    _loadDashProjects();
    _loadDashLibrary();
  });

  // REMOVE track
  body.querySelectorAll('[data-remove-track]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const cid = btn.dataset.removeTrack;
      await api.dashboard.vault.removeTrack(proj.id, cid);
      _loadDashProjects();
      _loadDashLibrary();
    });
  });

  // ADD track
  addBtn.addEventListener('click', async () => {
    const cid = addSel.value;
    if (!cid) return;
    const { res } = await api.dashboard.vault.addTrack(proj.id, { content_id: parseInt(cid, 10) });
    if (res.ok) {
      _loadDashProjects();
      _loadDashLibrary();
    } else if (res.status === 409) {
      addMsg.style.color = '#ff6b6b';
      addMsg.textContent = 'Already in a project';
    } else {
      addMsg.style.color = '#ff6b6b';
      addMsg.textContent = 'Error adding track';
    }
  });

  // SAVE PRICING
  pricingDiv.querySelector(`#pprice-save-${proj.id}`).addEventListener('click', async () => {
    const msgEl     = pricingDiv.querySelector(`#pprice-msg-${proj.id}`);
    const name      = pricingDiv.querySelector(`#pprice-name-${proj.id}`).value.trim();
    const desc      = pricingDiv.querySelector(`#pprice-desc-${proj.id}`).value.trim();
    const suggRaw   = parseFloat(pricingDiv.querySelector(`#pprice-sugg-${proj.id}`).value) || 0;
    const minRaw    = parseFloat(pricingDiv.querySelector(`#pprice-min-${proj.id}`).value) || 0;
    const allowFree = pricingDiv.querySelector(`#pprice-free-${proj.id}`).checked;
    if (!name) { msgEl.style.color='#ff6b6b'; msgEl.textContent='Name required'; return; }
    if (!allowFree && minRaw < 0.01) { msgEl.style.color='#ff6b6b'; msgEl.textContent='Minimum must be ≥ $0.01 when free is disabled'; return; }
    const { res } = await api.dashboard.vault.updateProject(proj.id, {
      name,
      description:     desc || null,
      suggested_price: Math.round(suggRaw * 100),
      minimum_price:   Math.round(minRaw  * 100),
      allow_free:      allowFree,
      payment_type:    'one_time',
    });
    if (res.ok) {
      msgEl.style.color = 'rgba(255,255,255,.5)';
      msgEl.textContent = '✓ SAVED';
      setTimeout(() => { msgEl.textContent = ''; }, 2500);
      _loadDashProjects();
      _loadDashLibrary();
    } else {
      msgEl.style.color = '#ff6b6b';
      msgEl.textContent = 'Save failed';
    }
  });

  return card;
}

// ── Project creation handler ───────────────────────────────────────────────────
export function initProjectHandlers() {
  el('btn-new-proj').addEventListener('click', async () => {
    const msgEl    = el('new-proj-msg');
    const name     = el('new-proj-name').value.trim();
    const desc     = el('new-proj-desc').value.trim();
    const suggRaw  = parseFloat(el('new-proj-sugg').value) || 0;
    const minRaw   = parseFloat(el('new-proj-min').value)  || 0;
    const allowFree = el('new-proj-free').checked;
    if (!name) { msgEl.style.color='#ff6b6b'; msgEl.textContent='Name is required'; return; }
    if (!allowFree && minRaw < 0.01) { msgEl.style.color='#ff6b6b'; msgEl.textContent='Minimum must be ≥ $0.01 when free is disabled'; return; }
    msgEl.style.color = 'rgba(255,255,255,.4)';
    msgEl.textContent = 'Creating…';
    const { res } = await api.dashboard.vault.createProject({
      name,
      description:     desc || null,
      cover_art_path:  el('new-proj-art').value.trim() || null,
      suggested_price: Math.round(suggRaw * 100),
      minimum_price:   Math.round(minRaw  * 100),
      allow_free:      allowFree,
      payment_type:    'one_time',
    });
    if (res.ok) {
      el('new-proj-name').value   = '';
      el('new-proj-desc').value   = '';
      el('new-proj-art').value    = '';
      el('new-proj-sugg').value   = '';
      el('new-proj-min').value    = '';
      el('new-proj-free').checked = false;
      msgEl.textContent = '';
      el('dash-new-proj').open = false;
      _loadDashProjects();
      _loadDashLibrary();
    } else {
      msgEl.style.color = '#ff6b6b';
      msgEl.textContent = 'Error creating project';
    }
  });
}
