/**
 * dashboard/vault.js — Vault stats, library, token management, and uploads.
 */

import * as api from '../api.js';
import { el, esc, trackColor } from '../utils.js';
import { isDesktopPlatform } from './index.js';

// ── Module-local state ─────────────────────────────────────────────────────────
let vaultStatsBound   = false;
let _activeVaultPanel = null;

// ── Injected callbacks ─────────────────────────────────────────────────────────
let _loadDashVaultStats = () => {};
let _loadLibrary        = () => {};
let _makeTypeahead      = () => {};
let _getDashAccounts    = () => [];

export function init(callbacks = {}) {
  if (callbacks.loadDashVaultStats) _loadDashVaultStats = callbacks.loadDashVaultStats;
  if (callbacks.loadLibrary)        _loadLibrary        = callbacks.loadLibrary;
  if (callbacks.makeTypeahead)      _makeTypeahead      = callbacks.makeTypeahead;
  if (callbacks.getDashAccounts)    _getDashAccounts    = callbacks.getDashAccounts;
}

// ── Vault stats ────────────────────────────────────────────────────────────────
export async function loadDashVaultStats() {
  try {
    const mediaItems = await api.dashboard.media.list();
    const lockedCount = mediaItems.filter(it => it.visibility === 'vault' || it.visibility === 'supporters_only').length;
    el('vs-tracks').textContent = mediaItems.length;
    el('vs-locked').textContent = lockedCount;
  } catch {}

  if (!isDesktopPlatform()) return;
  try {
    const tokens = await api.dashboard.tokens.list();
    el('vs-tokens').textContent = tokens.length;
  } catch {}
}

// ── Vault stat button bindings ─────────────────────────────────────────────────
export function bindVaultStatButtons() {
  if (vaultStatsBound) return;
  vaultStatsBound = true;
  ['tracks', 'locked', 'tokens'].forEach(name => {
    el('vsb-' + name).addEventListener('click', () => openVaultPanel(name));
  });
}

// ── Vault panel toggle ─────────────────────────────────────────────────────────
export function openVaultPanel(name) {
  if (_activeVaultPanel === name) {
    el('vault-panel-' + name).hidden = true;
    el('vsb-' + name).classList.remove('active');
    _activeVaultPanel = null;
    return;
  }
  if (_activeVaultPanel) {
    el('vault-panel-' + _activeVaultPanel).hidden = true;
    el('vsb-' + _activeVaultPanel).classList.remove('active');
  }
  _activeVaultPanel = name;
  el('vault-panel-' + name).hidden = false;
  el('vsb-' + name).classList.add('active');
  if (name === 'tracks')      loadDashLibrary();
  else if (name === 'locked') loadDashLockedTracks();
  else if (name === 'tokens') loadDashTokens();
}

// ── Locked tracks ──────────────────────────────────────────────────────────────
export async function loadDashLockedTracks() {
  try {
    const [items, highlight] = await Promise.all([
      api.dashboard.media.list(),
      api.dashboard.vault.getHighlight(),
    ]);
    const locked = items.filter(it => it.visibility === 'vault' || it.visibility === 'supporters_only');
    const list   = el('dash-locked-list');
    list.innerHTML = '';
    if (!locked.length) {
      list.innerHTML = '<div style="font-size:11px;color:rgba(255,255,255,.25);font-family:\'Space Mono\',monospace;padding:8px 14px;">No locked tracks.</div>';
      return;
    }
    for (const item of locked) list.appendChild(buildDashLibItem(item, 'track', item.id, false, highlight));
  } catch {}
}

// ── Highlight toggle (shared by tracks + projects) ─────────────────────────────
// btn carries its own current state in a data attribute so repeated clicks
// (without a full re-render) stay correct.
export async function toggleHighlight(btn, type, id) {
  const isHighlighted = btn.dataset.highlighted === '1';
  btn.disabled = true;
  await api.dashboard.vault.setHighlight(isHighlighted ? { type: null, id: null } : { type, id });
  btn.disabled = false;
  btn.dataset.highlighted = isHighlighted ? '0' : '1';
  btn.textContent = isHighlighted ? '☆ HIGHLIGHT' : '★ HIGHLIGHTED';
  btn.classList.toggle('active', !isHighlighted);
}

// ── Library item builder ───────────────────────────────────────────────────────
export function buildDashLibItem(item, scopeType, scopeId, nested = false, highlight = null) {
  const c    = trackColor(item.id);
  const isHighlighted = highlight?.highlight_type === 'track' && highlight?.highlight_id === item.id;
  const wrap = document.createElement('div');
  if (nested) wrap.className = 'dash-lib-nested';

  const panelId     = `${scopeType}-${scopeId}`;
  const tokListId   = `dtl-${panelId}`;
  const tokLabelId  = `dtla-${panelId}`;
  const tokResultId = `dtr-${panelId}`;
  const tokPanelId  = `dtp-${panelId}`;

  wrap.innerHTML = `
    <div class="mgmt-row">
      <div class="mgmt-thumb" style="background:linear-gradient(135deg,${c}44,${c}11);border:1px solid ${c}33;position:relative;overflow:hidden;">${item.artwork_url?`<img src="/api/library/${item.id}/artwork" loading="lazy" onerror="this.style.display='none'" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;display:block;"/>`:(item.category==='videos'?'▶':'♪')}<button class="lib-queue-btn" data-id="${item.id}" data-title="${esc(item.title||'')}" data-artist="${esc(item.artist||'')}" title="Queue for broadcast">+</button></div>
      <div class="mgmt-info">
        <div class="mgmt-title">${esc(item.title||item.filename)}</div>
        <div style="display:flex;align-items:center;gap:6px;">
          <div class="mgmt-meta">${esc(item.category)}</div>
          <span class="track-plays" id="plays-${item.id}">▶ ${(window._playCounts && window._playCounts[item.id]) ? window._playCounts[item.id] : 0}</span>
        </div>
      </div>
      <div class="mgmt-actions">
        <select class="dash-select" id="vis-${item.id}">
          <option value="public"${item.visibility==='public'?' selected':''}>PUBLIC</option>
          <option value="supporters_only"${item.visibility==='supporters_only'?' selected':''}>SUPPORTERS</option>
          <option value="vault"${item.visibility==='vault'?' selected':''}>VAULT</option>
        </select>
        <button class="mgmt-btn" id="save-${item.id}">SAVE</button>
        <button class="mgmt-btn" id="edit-tog-${item.id}">✎ EDIT</button>
        <button class="mgmt-btn${isHighlighted ? ' active' : ''}" id="hl-tog-${item.id}" data-highlighted="${isHighlighted ? '1' : '0'}">${isHighlighted ? '★ HIGHLIGHTED' : '☆ HIGHLIGHT'}</button>
        ${isDesktopPlatform() ? `<button class="mgmt-btn" id="tok-tog-${panelId}" style="letter-spacing:.03em;">⬡ TOKEN</button>` : ''}
      </div>
    </div>
    ${isDesktopPlatform() ? `
    <div class="dash-tok-panel" id="${tokPanelId}" hidden>
      <div id="${tokListId}"></div>
      <div class="dash-form-row" style="padding:6px 14px 0;gap:6px;">
        <input type="text" class="dash-input dash-input-sm" id="${tokLabelId}" placeholder="Label…" style="flex:1;min-width:80px;"/>
        <button class="mgmt-btn" id="tok-create-${panelId}">CREATE</button>
      </div>
      <div id="${tokResultId}" style="padding:3px 14px 4px;"></div>
    </div>` : ''}
    <div class="dash-edit-panel" id="edit-panel-${item.id}" hidden>
      <div class="dash-edit-grid">
        <div>
          <div class="dash-edit-label">TITLE</div>
          <input class="dash-input dash-input-sm" id="edit-title-${item.id}" value="${esc(item.title||'')}" placeholder="Track title"/>
        </div>
        <div>
          <div class="dash-edit-label">ARTIST</div>
          <input class="dash-input dash-input-sm" id="edit-artist-${item.id}" value="${esc(item.artist||'')}" placeholder="Artist name"/>
        </div>
        <div>
          <div class="dash-edit-label">ALBUM</div>
          <input class="dash-input dash-input-sm" id="edit-album-${item.id}" value="${esc(item.album||'')}" placeholder="Album / EP / single"/>
        </div>
        <div>
          <div class="dash-edit-label">PRODUCER</div>
          <input class="dash-input dash-input-sm" id="edit-producer-${item.id}" value="${esc(item.producer||'')}" placeholder="Produced by…"/>
        </div>
      </div>
      <div>
        <div class="dash-edit-label">ART URL <span style="font-size:11px;opacity:.5;">or upload below</span></div>
        <input class="dash-input dash-input-sm" id="edit-art-${item.id}" value="${esc(item.artwork_url||'')}" placeholder="https://… (optional)"/>
      </div>
      <div style="margin-top:4px;">
        <div class="dash-edit-label">UPLOAD ART</div>
        <div style="display:flex;align-items:center;gap:8px;">
          <label id="art-upload-label-${item.id}" style="font-family:'Space Mono',monospace;font-size:10px;letter-spacing:.06em;padding:4px 10px;background:var(--raised);border:1px solid var(--border);border-radius:var(--radius-xs);cursor:pointer;color:var(--t3);white-space:nowrap;">
            BROWSE…
            <input type="file" id="edit-art-file-${item.id}" accept="image/*" style="display:none;"/>
          </label>
          <span id="art-filename-${item.id}" style="font-family:'Space Mono',monospace;font-size:10px;color:var(--t4);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"></span>
          <button class="mgmt-btn" id="art-upload-btn-${item.id}" style="display:none;">UPLOAD</button>
        </div>
        <div id="art-upload-msg-${item.id}" style="font-family:'Space Mono',monospace;font-size:10px;margin-top:3px;"></div>
      </div>
      <div class="dash-edit-label">CREDITS</div>
      <textarea class="dash-input dash-input-sm" id="edit-credits-${item.id}" placeholder="Mixed by, mastered by, features, etc.">${esc(item.credits||'')}</textarea>
      <div class="dash-form-row" style="margin-top:8px;justify-content:flex-end;gap:8px;">
        <span id="edit-msg-${item.id}" style="font-family:'Space Mono',monospace;font-size:10px;flex:1;"></span>
        <button class="mgmt-btn" id="edit-save-${item.id}">SAVE CHANGES</button>
      </div>
    </div>`;

  const saveBtn = wrap.querySelector(`#save-${item.id}`);
  saveBtn.addEventListener('click', async () => {
    const vis = wrap.querySelector(`#vis-${item.id}`).value;
    saveBtn.disabled = true;
    await api.dashboard.media.update(item.id, { visibility: vis });
    saveBtn.disabled = false;
    saveBtn.textContent = '✓';
    setTimeout(() => { saveBtn.textContent = 'SAVE'; }, 1500);
  });

  // Toggle edit panel
  wrap.querySelector(`#edit-tog-${item.id}`).addEventListener('click', () => {
    const panel = wrap.querySelector(`#edit-panel-${item.id}`);
    panel.hidden = !panel.hidden;
  });

  // Save metadata changes
  wrap.querySelector(`#edit-save-${item.id}`).addEventListener('click', async () => {
    const saveBtn = wrap.querySelector(`#edit-save-${item.id}`);
    const msgEl   = wrap.querySelector(`#edit-msg-${item.id}`);
    const body = {
      title:       wrap.querySelector(`#edit-title-${item.id}`).value.trim()   || null,
      artist:      wrap.querySelector(`#edit-artist-${item.id}`).value.trim()  || null,
      album:       wrap.querySelector(`#edit-album-${item.id}`).value.trim()   || null,
      producer:    wrap.querySelector(`#edit-producer-${item.id}`).value.trim()|| null,
      credits:     wrap.querySelector(`#edit-credits-${item.id}`).value.trim() || null,
      artwork_url: wrap.querySelector(`#edit-art-${item.id}`).value.trim()     || null,
    };
    saveBtn.disabled = true; saveBtn.textContent = '…';
    try {
      const { res, data } = await api.dashboard.media.update(item.id, body);
      if (res.ok) {
        Object.assign(item, body);
        wrap.querySelector('.mgmt-title').textContent = body.title || item.filename;
        saveBtn.textContent = '✓ SAVED';
        msgEl.textContent = ''; msgEl.style.color = '';
        setTimeout(() => { saveBtn.textContent = 'SAVE CHANGES'; }, 1800);
      } else {
        msgEl.textContent = data.error || 'Save failed';
        msgEl.style.color = '#ff6b6b';
        saveBtn.textContent = 'SAVE CHANGES';
      }
    } catch {
      msgEl.textContent = 'Network error';
      msgEl.style.color = '#ff6b6b';
      saveBtn.textContent = 'SAVE CHANGES';
    }
    saveBtn.disabled = false;
  });

  // Artwork file upload
  const artFileInput = wrap.querySelector(`#edit-art-file-${item.id}`);
  const artFilename  = wrap.querySelector(`#art-filename-${item.id}`);
  const artUploadBtn = wrap.querySelector(`#art-upload-btn-${item.id}`);
  const artUploadMsg = wrap.querySelector(`#art-upload-msg-${item.id}`);
  artFileInput.addEventListener('change', () => {
    const f = artFileInput.files[0];
    if (!f) return;
    artFilename.textContent    = f.name;
    artUploadBtn.style.display = '';
  });
  artUploadBtn.addEventListener('click', async () => {
    const f = artFileInput.files[0];
    if (!f) return;
    artUploadBtn.disabled = true; artUploadBtn.textContent = '…';
    artUploadMsg.textContent = ''; artUploadMsg.style.color = '';
    const fd = new FormData();
    fd.append('artwork', f);
    try {
      const { res, data } = await api.dashboard.media.uploadArtwork(item.id, fd);
      if (res.ok) {
        artUploadMsg.textContent = '✓ Art uploaded';
        artUploadMsg.style.color = '#39ff14';
        artUploadBtn.textContent = '✓';
        const thumb = wrap.querySelector('.mgmt-thumb img');
        if (thumb) { thumb.src = data.artworkUrl + '?t=' + Date.now(); thumb.style.display = ''; }
        setTimeout(() => { artUploadBtn.textContent = 'UPLOAD'; artUploadBtn.disabled = false; }, 2000);
      } else {
        artUploadMsg.textContent = data.error || 'Upload failed';
        artUploadMsg.style.color = '#ff6b6b';
        artUploadBtn.textContent = 'UPLOAD'; artUploadBtn.disabled = false;
      }
    } catch {
      artUploadMsg.textContent = 'Network error';
      artUploadMsg.style.color = '#ff6b6b';
      artUploadBtn.textContent = 'UPLOAD'; artUploadBtn.disabled = false;
    }
  });

  wrap.querySelector(`#hl-tog-${item.id}`).addEventListener('click', () => {
    toggleHighlight(wrap.querySelector(`#hl-tog-${item.id}`), 'track', item.id);
  });

  if (isDesktopPlatform()) {
    wrap.querySelector(`#tok-tog-${panelId}`).addEventListener('click', async () => {
      const panel = document.getElementById(tokPanelId);
      panel.hidden = !panel.hidden;
      if (!panel.hidden) await refreshDashTokenList(tokListId, scopeType, scopeId);
    });

    wrap.querySelector(`#tok-create-${panelId}`).addEventListener('click', async () => {
      const label = document.getElementById(tokLabelId).value.trim();
      if (!label) return;
      const { res, data } = await api.dashboard.tokens.create({ label, tier: 'subscriber', scope_type: scopeType, scope_id: scopeId });
      if (res.ok) {
        document.getElementById(tokLabelId).value = '';
        document.getElementById(tokResultId).innerHTML = `
          <div class="dash-success-msg" style="font-size:10px;margin-bottom:4px;">Share once — won't be shown again:</div>
          <div style="background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:6px;padding:6px 8px;font-family:'Space Mono',monospace;font-size:10px;color:rgba(255,255,255,.6);word-break:break-all;">${esc(data.token)}</div>`;
        await refreshDashTokenList(tokListId, scopeType, scopeId);
      }
    });
  }

  return wrap;
}

// ── Library project builder ────────────────────────────────────────────────────
export function buildDashLibProject(proj, allItems, highlight = null) {
  const tracks = (proj.items || [])
    .map(pi => allItems.find(it => it.id === pi.content_id))
    .filter(Boolean);

  const wrap     = document.createElement('div');
  wrap.className = 'dash-lib-project';

  const projPanelId = `project-${proj.id}`;
  const tokListId   = `dtl-${projPanelId}`;
  const tokLabelId  = `dtla-${projPanelId}`;
  const tokResultId = `dtr-${projPanelId}`;
  const tokPanelId  = `dtp-${projPanelId}`;

  const header = document.createElement('div');
  header.innerHTML = `
    <div class="dash-lib-proj-header">
      <span class="dash-lib-proj-name">${esc(proj.name)}</span>
      <span style="font-family:'Space Mono',monospace;font-size:10px;color:rgba(255,255,255,.25);">${tracks.length} TRACKS</span>
      ${isDesktopPlatform() ? `<button class="mgmt-btn" id="tok-tog-${projPanelId}" style="letter-spacing:.03em;">⬡ COLLECTION TOKEN</button>` : ''}
    </div>
    ${isDesktopPlatform() ? `
    <div class="dash-tok-panel" id="${tokPanelId}" hidden>
      <div id="${tokListId}"></div>
      <div class="dash-form-row" style="padding:6px 14px 0;gap:6px;">
        <input type="text" class="dash-input dash-input-sm" id="${tokLabelId}" placeholder="Label…" style="flex:1;min-width:80px;"/>
        <button class="mgmt-btn" id="tok-create-${projPanelId}">CREATE</button>
      </div>
      <div id="${tokResultId}" style="padding:3px 14px 4px;"></div>
    </div>` : ''}`;

  if (isDesktopPlatform()) {
    header.querySelector(`#tok-tog-${projPanelId}`).addEventListener('click', async () => {
      const panel = document.getElementById(tokPanelId);
      panel.hidden = !panel.hidden;
      if (!panel.hidden) await refreshDashTokenList(tokListId, 'project', proj.id);
    });

    header.querySelector(`#tok-create-${projPanelId}`).addEventListener('click', async () => {
      const label = document.getElementById(tokLabelId).value.trim();
      if (!label) return;
      const { res, data } = await api.dashboard.tokens.create({ label, tier: 'subscriber', scope_type: 'project', scope_id: proj.id });
      if (res.ok) {
        document.getElementById(tokLabelId).value = '';
        document.getElementById(tokResultId).innerHTML = `
          <div class="dash-success-msg" style="font-size:10px;margin-bottom:4px;">Share once — won't be shown again:</div>
          <div style="background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:6px;padding:6px 8px;font-family:'Space Mono',monospace;font-size:10px;color:rgba(255,255,255,.6);word-break:break-all;">${esc(data.token)}</div>`;
        await refreshDashTokenList(tokListId, 'project', proj.id);
      }
    });
  }

  wrap.appendChild(header);
  tracks.forEach(item => wrap.appendChild(buildDashLibItem(item, 'track', item.id, true, highlight)));
  return wrap;
}

// ── Scoped token list refresh ──────────────────────────────────────────────────
export async function refreshDashTokenList(listElId, scopeType, scopeId) {
  try {
    const tokens = await api.dashboard.tokens.forScope(scopeType, scopeId);
    const listEl = document.getElementById(listElId);
    if (!listEl) return;
    listEl.innerHTML = tokens.length
      ? tokens.map(t => `
          <div class="dash-tok-panel-token">
            <span style="flex:1;color:rgba(255,255,255,.4);">${esc(t.label||'—')}</span>
            <span style="color:rgba(255,255,255,.2);">${t.last_used?t.last_used.slice(0,10):'unused'}</span>
            <button class="mgmt-btn${t.is_active?' danger':''}" data-revoke="${t.id}" ${!t.is_active?'disabled':''}>
              ${t.is_active?'REVOKE':'REVOKED'}
            </button>
          </div>`).join('')
      : '<div style="padding:4px 14px;font-family:\'Space Mono\',monospace;font-size:10px;color:rgba(255,255,255,.2);">No tokens yet.</div>';
    listEl.querySelectorAll('[data-revoke]').forEach(btn => {
      btn.addEventListener('click', async () => {
        await api.dashboard.tokens.revoke(btn.dataset.revoke);
        refreshDashTokenList(listElId, scopeType, scopeId);
      });
    });
  } catch {}
}

// ── Full library view ──────────────────────────────────────────────────────────
export async function loadDashLibrary() {
  try {
    const [items, pricing, highlight] = await Promise.all([
      api.dashboard.media.list(),
      api.dashboard.vault.pricing(),
      api.dashboard.vault.getHighlight(),
    ]);

    const list        = el('dash-lib-list');
    const projectedIds = new Set(
      (pricing.projects || []).flatMap(p => (p.items || []).map(i => i.content_id))
    );
    const standalone = items.filter(it => !projectedIds.has(it.id));

    list.innerHTML = '';

    for (const proj of (pricing.projects || [])) {
      list.appendChild(buildDashLibProject(proj, items, highlight));
    }
    for (const item of standalone) {
      list.appendChild(buildDashLibItem(item, 'track', item.id, false, highlight));
    }

    if (!items.length) {
      list.innerHTML = '<div style="font-size:11px;color:rgba(255,255,255,.25);font-family:\'Space Mono\',monospace;padding:8px 14px;">No media yet.</div>';
    }
  } catch {}
}

// ── Token management ───────────────────────────────────────────────────────────
export async function loadDashTokens() {
  if (!isDesktopPlatform()) return;
  try {
    const tokens = await api.dashboard.tokens.list();
    const list   = el('dash-token-list');
    list.innerHTML = '';
    if (!tokens.length) {
      list.innerHTML = '<div style="font-size:11px;color:rgba(255,255,255,.25);font-family:\'Space Mono\',monospace;padding:8px 14px;">No tokens yet.</div>';
      return;
    }
    for (const t of tokens) {
      const wrap = document.createElement('div');
      wrap.innerHTML = `
        <div class="mgmt-row" style="flex-wrap:wrap;gap:6px;">
          <div class="mgmt-info" style="flex:1;min-width:120px;">
            <div class="mgmt-title">${esc(t.label || '—')}</div>
            <div class="mgmt-meta">${t.last_used ? 'used ' + t.last_used.slice(0,10) : 'never used'}</div>
          </div>
          ${t.is_active ? `
            <select class="dash-select dash-input-sm" id="tier-sel-${t.id}" style="width:auto;">
              <option value="subscriber"${t.tier==='subscriber'?' selected':''}>Subscriber</option>
              <option value="pro"${t.tier==='pro'?' selected':''}>Pro</option>
              <option value="all_access"${t.tier==='all_access'?' selected':''}>All-Access</option>
            </select>
            <button class="mgmt-btn" id="tier-upd-${t.id}">UPDATE</button>
            ${isDesktopPlatform() ? `<button class="mgmt-btn" id="assign-tog-${t.id}" style="letter-spacing:.03em;">⊕ ASSIGN</button>` : ''}
          ` : ''}
          <button class="mgmt-btn${t.is_active ? ' danger' : ''}" id="revoke-${t.id}" ${!t.is_active ? 'disabled' : ''}>
            ${t.is_active ? 'REVOKE' : 'REVOKED'}
          </button>
        </div>
        ${t.is_active && isDesktopPlatform() ? `
        <div class="dash-tok-panel" id="assign-panel-${t.id}" hidden>
          <div id="assign-list-${t.id}"></div>
          <div class="dash-form-row" style="padding:6px 14px 0;gap:6px;">
            <div style="flex:1;min-width:120px;position:relative;">
              <input class="dash-input dash-input-sm" id="assign-email-${t.id}" type="text" placeholder="search accounts…" style="width:100%;box-sizing:border-box;" autocomplete="off"/>
              <div class="typeahead-drop" id="assign-drop-${t.id}" hidden></div>
            </div>
            <button class="mgmt-btn" id="assign-add-${t.id}">ASSIGN</button>
          </div>
          <div id="assign-msg-${t.id}" style="padding:3px 14px 6px;font-family:'Space Mono',monospace;font-size:10px;"></div>
        </div>` : ''}`;

      if (t.is_active) {
        wrap.querySelector(`#tier-upd-${t.id}`).addEventListener('click', async () => {
          const btn = wrap.querySelector(`#tier-upd-${t.id}`);
          btn.textContent = '…';
          await api.dashboard.tokens.setTier(t.id, { tier: wrap.querySelector(`#tier-sel-${t.id}`).value });
          loadDashTokens();
        });

        if (isDesktopPlatform()) {
          wrap.querySelector(`#assign-tog-${t.id}`).addEventListener('click', async () => {
            const panel = wrap.querySelector(`#assign-panel-${t.id}`);
            panel.hidden = !panel.hidden;
            if (!panel.hidden) {
              await refreshAssignmentList(t.id, wrap);
              _makeTypeahead(
                wrap.querySelector(`#assign-email-${t.id}`),
                wrap.querySelector(`#assign-drop-${t.id}`),
                _getDashAccounts()
              );
            }
          });

          wrap.querySelector(`#assign-add-${t.id}`).addEventListener('click', async () => {
            const emailInput = wrap.querySelector(`#assign-email-${t.id}`);
            const msgEl      = wrap.querySelector(`#assign-msg-${t.id}`);
            const email = emailInput.value.trim();
            if (!email) return;
            const { res, data } = await api.dashboard.tokens.assign(t.id, { email });
            if (res.ok) {
              emailInput.value  = '';
              msgEl.style.color = 'rgba(255,255,255,.45)';
              msgEl.textContent = `✓ Assigned to ${data.email}`;
              setTimeout(() => { msgEl.textContent = ''; }, 2500);
              await refreshAssignmentList(t.id, wrap);
            } else {
              msgEl.style.color = '#ff6b6b';
              msgEl.textContent = data.error || 'Assignment failed';
            }
          });
        }
      }

      wrap.querySelector(`#revoke-${t.id}`).addEventListener('click', async () => {
        await api.dashboard.tokens.revoke(t.id);
        loadDashTokens();
      });

      list.appendChild(wrap);
    }
  } catch {}
}

export async function refreshAssignmentList(tokenId, wrap) {
  const listEl = wrap.querySelector(`#assign-list-${tokenId}`);
  try {
    const rows = await api.dashboard.tokens.assignments(tokenId);
    if (!rows.length) {
      listEl.innerHTML = '<div style="padding:4px 14px;font-family:\'Space Mono\',monospace;font-size:10px;color:rgba(255,255,255,.2);">No accounts assigned yet.</div>';
      return;
    }
    listEl.innerHTML = rows.map(a => `
      <div class="dash-tok-panel-token">
        <span style="flex:1;color:rgba(255,255,255,.5);">${esc(a.email)}</span>
        <span style="color:rgba(255,255,255,.2);">${a.created_at ? a.created_at.slice(0,10) : ''}</span>
        <button class="mgmt-btn danger" data-unassign="${a.id}">REMOVE</button>
      </div>`).join('');
    listEl.querySelectorAll('[data-unassign]').forEach(btn => {
      btn.addEventListener('click', async () => {
        await api.dashboard.tokens.unassign(tokenId, btn.dataset.unassign);
        await refreshAssignmentList(tokenId, wrap);
      });
    });
  } catch {
    listEl.innerHTML = '<div style="padding:4px 14px;font-size:10px;color:#ff6b6b;">Failed to load assignments.</div>';
  }
}

// ── Token creation handler ─────────────────────────────────────────────────────
export function initTokenHandlers() {
  el('btn-create-token').addEventListener('click', async () => {
    const label = el('new-token-label').value.trim();
    const tier  = el('new-token-tier').value;
    const email = el('new-token-email').value.trim();
    if (!label) return;
    try {
      const { res, data } = await api.dashboard.tokens.create({ label, tier });
      if (!res.ok) throw new Error(data.error || 'Failed');

      let assignNote = '';
      if (email && data.id) {
        const { res: aRes, data: aData } = await api.dashboard.tokens.assign(data.id, { email });
        assignNote = aRes.ok
          ? `<div class="dash-success-msg" style="margin-top:4px;">Assigned to ${esc(email)}</div>`
          : `<div class="dash-error-msg" style="margin-top:4px;">${esc(aData.error || 'Assignment failed')}</div>`;
      }

      el('new-token-result').innerHTML = `
        <div class="dash-success-msg">Token created — share once, won't be shown again:</div>
        <div style="background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:7px;padding:8px 10px;margin-top:6px;font-family:'Space Mono',monospace;font-size:11px;color:rgba(255,255,255,.7);word-break:break-all;">${esc(data.token)}</div>
        ${assignNote}`;
      el('new-token-label').value = '';
      el('new-token-email').value = '';
      loadDashTokens();
    } catch (err) {
      el('new-token-result').innerHTML = `<div class="dash-error-msg">${esc(err.message)}</div>`;
    }
  });
}
