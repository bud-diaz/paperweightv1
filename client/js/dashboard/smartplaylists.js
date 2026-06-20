/**
 * dashboard/smartplaylists.js — Smart playlist (category + tags) management.
 */

import * as api from '../api.js';
import { el, esc } from '../utils.js';

export function init() {}

async function loadTrackCount(playlistId) {
  try {
    const { count } = await api.dashboard.schedule.smartPlaylists.preview(playlistId);
    return count;
  } catch {
    return null;
  }
}

export async function loadDashSmartPlaylists() {
  const list = el('dash-smart-playlist-list');
  if (!list) return;
  try {
    const playlists = await api.dashboard.schedule.smartPlaylists.list();

    if (!playlists.length) {
      list.innerHTML = '<div style="font-size:11px;color:rgba(255,255,255,.25);font-family:\'Space Mono\',monospace;padding:8px 14px;">No smart playlists.</div>';
      return;
    }

    list.innerHTML = '';
    for (const p of playlists) {
      let tags = [];
      try {
        const parsed = p.tags_filter ? JSON.parse(p.tags_filter) : [];
        tags = Array.isArray(parsed) ? parsed : [];
      } catch {}
      const tagSummary = tags.length ? tags.join(', ') : 'no tags';

      const row = document.createElement('div');
      row.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:9px 14px;border-radius:7px;margin-bottom:1px;">
          <div>
            <div style="font-family:'DM Serif Display',serif;font-size:15px;color:rgba(255,255,255,.78);">${esc(p.name)}</div>
            <div style="font-family:'Space Mono',monospace;font-size:10px;color:rgba(255,255,255,.3);margin-top:2px;">${esc(p.category || 'any category')} · ${esc(tagSummary)} · ${esc(p.mode)} · <span data-track-count="${p.id}">…tracks</span></div>
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <button class="mgmt-btn" data-assign-playlist="${p.id}">ASSIGN</button>
            <button class="mgmt-btn" data-edit-playlist="${p.id}">EDIT</button>
            <button class="mgmt-btn danger" data-del-playlist="${p.id}">DEL</button>
          </div>
        </div>
        <div class="sp-edit-form" id="sp-edit-${p.id}" hidden style="padding:0 14px 10px;display:none;">
          <div class="dash-form-row" style="flex-wrap:wrap;gap:6px;margin-bottom:6px;">
            <input type="text" class="dash-input dash-input-sm" id="sp-name-${p.id}" placeholder="Name…" value="${esc(p.name)}" style="flex:2;min-width:100px;"/>
            <input type="text" class="dash-input dash-input-sm" id="sp-desc-${p.id}" placeholder="Description…" value="${esc(p.description || '')}" style="flex:2;min-width:100px;"/>
            <select class="dash-select" id="sp-cat-${p.id}">
              <option value="">Any</option>
              <option value="music"${p.category==='music'?' selected':''}>Music</option>
              <option value="beats"${p.category==='beats'?' selected':''}>Beats</option>
              <option value="podcasts"${p.category==='podcasts'?' selected':''}>Podcasts</option>
              <option value="videos"${p.category==='videos'?' selected':''}>Videos</option>
              <option value="drafts"${p.category==='drafts'?' selected':''}>Drafts</option>
              <option value="live_sessions"${p.category==='live_sessions'?' selected':''}>Live sessions</option>
            </select>
            <select class="dash-select" id="sp-mode-${p.id}">
              <option value="shuffle"${p.mode==='shuffle'?' selected':''}>Shuffle</option>
              <option value="sequential"${p.mode==='sequential'?' selected':''}>Sequential</option>
            </select>
          </div>
          <div class="dash-form-row" style="gap:6px;margin-bottom:6px;">
            <input type="text" class="dash-input dash-input-sm" id="sp-tags-${p.id}" placeholder="tags, comma, separated" value="${esc(tags.join(', '))}" style="flex:1;"/>
          </div>
          <div style="display:flex;justify-content:flex-end;gap:8px;">
            <span id="sp-msg-${p.id}" style="font-family:'Space Mono',monospace;font-size:10px;flex:1;"></span>
            <button class="mgmt-btn" id="sp-save-${p.id}">SAVE</button>
          </div>
        </div>`;
      list.appendChild(row);

      loadTrackCount(p.id).then(count => {
        const span = row.querySelector(`[data-track-count="${p.id}"]`);
        if (span) span.textContent = count === null ? 'unknown tracks' : `${count} track${count === 1 ? '' : 's'}`;
      });

      row.querySelector(`[data-edit-playlist="${p.id}"]`).addEventListener('click', () => {
        const form     = row.querySelector(`#sp-edit-${p.id}`);
        const isHidden = form.style.display === 'none' || form.hidden;
        form.style.display = isHidden ? '' : 'none';
        form.hidden        = !isHidden;
      });

      row.querySelector(`[data-del-playlist="${p.id}"]`).addEventListener('click', async () => {
        if (!confirm(`Delete smart playlist "${p.name}"?`)) return;
        await api.dashboard.schedule.smartPlaylists.remove(p.id);
        loadDashSmartPlaylists();
      });

      row.querySelector(`[data-assign-playlist="${p.id}"]`).addEventListener('click', () => {
        const addDetails = document.querySelector('.sched-add-details');
        const source      = el('sched-source');
        const targetId    = el('sched-target-id');
        if (source)   source.value   = 'smart_playlist';
        if (targetId) targetId.value = p.id;
        if (addDetails) {
          addDetails.open = true;
          addDetails.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });

      row.querySelector(`#sp-save-${p.id}`).addEventListener('click', async () => {
        const saveBtn = row.querySelector(`#sp-save-${p.id}`);
        const msgEl   = row.querySelector(`#sp-msg-${p.id}`);
        const tagsRaw = row.querySelector(`#sp-tags-${p.id}`).value;
        const tagsArr = tagsRaw.split(',').map(t => t.trim()).filter(Boolean);
        const body = {
          name:        row.querySelector(`#sp-name-${p.id}`).value.trim(),
          description: row.querySelector(`#sp-desc-${p.id}`).value.trim() || null,
          category:    row.querySelector(`#sp-cat-${p.id}`).value || null,
          tags_filter: tagsArr,
          mode:        row.querySelector(`#sp-mode-${p.id}`).value,
        };
        saveBtn.disabled = true; saveBtn.textContent = '…';
        try {
          const { res, data } = await api.dashboard.schedule.smartPlaylists.update(p.id, body);
          if (res.ok) {
            saveBtn.textContent = '✓';
            msgEl.textContent   = '';
            setTimeout(() => { loadDashSmartPlaylists(); }, 800);
          } else {
            msgEl.textContent   = data.error || 'Save failed';
            msgEl.style.color   = '#ff6b6b';
            saveBtn.textContent = 'SAVE'; saveBtn.disabled = false;
          }
        } catch {
          msgEl.textContent   = 'Network error';
          saveBtn.textContent = 'SAVE'; saveBtn.disabled = false;
        }
      });
    }
  } catch {}
}

export function initSmartPlaylistHandlers() {
  const btn = el('btn-add-smart-playlist');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const name = el('sp-new-name').value.trim();
    const msgEl = el('sp-new-msg');
    if (!name) {
      if (msgEl) { msgEl.textContent = 'Name is required'; msgEl.style.color = '#ff6b6b'; }
      return;
    }
    const tagsRaw = el('sp-new-tags').value;
    const tagsArr = tagsRaw.split(',').map(t => t.trim()).filter(Boolean);
    const body = {
      name,
      description: el('sp-new-desc').value.trim() || null,
      category:    el('sp-new-category').value || null,
      tags_filter: tagsArr,
      mode:        el('sp-new-mode').value,
    };
    const { res, data } = await api.dashboard.schedule.smartPlaylists.create(body);
    if (res.ok) {
      el('sp-new-name').value = '';
      el('sp-new-desc').value = '';
      el('sp-new-tags').value = '';
      if (msgEl) msgEl.textContent = '';
      loadDashSmartPlaylists();
    } else if (msgEl) {
      msgEl.textContent = data.error || 'Create failed';
      msgEl.style.color = '#ff6b6b';
    }
  });
}
