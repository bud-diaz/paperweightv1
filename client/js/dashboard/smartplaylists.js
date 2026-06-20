/**
 * dashboard/smartplaylists.js - Smart playlist (category + tags) management.
 */

import * as api from '../api.js';
import { el, esc, fmt } from '../utils.js';

let tagOptions = [];
let tagsLoaded = false;

export function init() {}

function splitTags(raw) {
  return String(raw || '').split(',').map(t => t.trim()).filter(Boolean);
}

function parseMediaTags(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function loadTagOptions() {
  if (tagsLoaded) return tagOptions;
  const items = await api.dashboard.media.list();
  const set = new Set();
  for (const item of items || []) {
    for (const tag of parseMediaTags(item.tags)) {
      if (tag) set.add(String(tag));
    }
  }
  tagOptions = [...set].sort((a, b) => a.localeCompare(b));
  tagsLoaded = true;
  installTagDatalist();
  return tagOptions;
}

function installTagDatalist() {
  let list = document.getElementById('sp-tags-options');
  if (!list) {
    list = document.createElement('datalist');
    list.id = 'sp-tags-options';
    document.body.appendChild(list);
  }
  list.innerHTML = tagOptions.map(tag => `<option value="${esc(tag)}"></option>`).join('');
  document.querySelectorAll('[data-sp-tags-input]').forEach(input => {
    input.setAttribute('list', 'sp-tags-options');
  });
}

async function loadTrackCount(playlistId) {
  try {
    const { count } = await api.dashboard.schedule.smartPlaylists.preview(playlistId);
    return count;
  } catch {
    return null;
  }
}

function playlistTags(playlist) {
  try {
    const parsed = playlist.tags_filter ? JSON.parse(playlist.tags_filter) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function renderPlaylistPreview(playlistId, host) {
  const panel = host.querySelector(`#sp-preview-${playlistId}`);
  if (!panel) return;
  panel.hidden = false;
  panel.innerHTML = '<div class="share-target-selected">Loading preview...</div>';
  try {
    const data = await api.dashboard.schedule.smartPlaylists.preview(playlistId);
    const tracks = Array.isArray(data.tracks) ? data.tracks : [];
    if (!tracks.length) {
      panel.innerHTML = '<div class="share-target-selected">No tracks match this playlist.</div>';
      return;
    }
    const totalDuration = tracks.reduce((sum, t) => sum + (Number(t.duration) || 0), 0);
    panel.innerHTML = `
      <div class="share-target-selected">${tracks.length} matching track${tracks.length === 1 ? '' : 's'}${totalDuration ? ' / ' + fmt(totalDuration) : ''}</div>
      ${tracks.slice(0, 20).map((track, index) => `
        <div class="sp-preview-row">
          <span>${index + 1}</span>
          <span class="sp-preview-title">${esc(track.title || track.filename || `Track #${track.id}`)}</span>
          <span>${esc(track.category || '')}</span>
        </div>
      `).join('')}
      ${tracks.length > 20 ? `<div class="share-target-selected">+${tracks.length - 20} more</div>` : ''}
    `;
  } catch {
    panel.innerHTML = '<div class="share-target-selected" style="color:#ff6b6b;">Preview failed.</div>';
  }
}

export async function loadDashSmartPlaylists() {
  const list = el('dash-smart-playlist-list');
  if (!list) return;
  try {
    await loadTagOptions().catch(() => {});
    const playlists = await api.dashboard.schedule.smartPlaylists.list();

    if (!playlists.length) {
      list.innerHTML = '<div style="font-size:11px;color:rgba(255,255,255,.25);font-family:\'Space Mono\',monospace;padding:8px 14px;">No smart playlists.</div>';
      return;
    }

    list.innerHTML = '';
    for (const p of playlists) {
      const tags = playlistTags(p);
      const tagSummary = tags.length ? tags.join(', ') : 'no tags';

      const row = document.createElement('div');
      row.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:9px 14px;border-radius:7px;margin-bottom:1px;">
          <div>
            <div style="font-family:'DM Serif Display',serif;font-size:15px;color:rgba(255,255,255,.78);">${esc(p.name)}</div>
            <div style="font-family:'Space Mono',monospace;font-size:10px;color:rgba(255,255,255,.3);margin-top:2px;">${esc(p.category || 'any category')} / ${esc(tagSummary)} / ${esc(p.mode)} / <span data-track-count="${p.id}">...tracks</span></div>
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <button class="mgmt-btn" data-preview-playlist="${p.id}">PREVIEW</button>
            <button class="mgmt-btn" data-assign-playlist="${p.id}">ASSIGN</button>
            <button class="mgmt-btn" data-edit-playlist="${p.id}">EDIT</button>
            <button class="mgmt-btn danger" data-del-playlist="${p.id}">DEL</button>
          </div>
        </div>
        <div class="sp-preview" id="sp-preview-${p.id}" hidden></div>
        <div class="sp-edit-form" id="sp-edit-${p.id}" hidden style="padding:0 14px 10px;display:none;">
          <div class="dash-form-row" style="flex-wrap:wrap;gap:6px;margin-bottom:6px;">
            <input type="text" class="dash-input dash-input-sm" id="sp-name-${p.id}" placeholder="Name..." value="${esc(p.name)}" style="flex:2;min-width:100px;"/>
            <input type="text" class="dash-input dash-input-sm" id="sp-desc-${p.id}" placeholder="Description..." value="${esc(p.description || '')}" style="flex:2;min-width:100px;"/>
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
            <input type="text" class="dash-input dash-input-sm" id="sp-tags-${p.id}" data-sp-tags-input placeholder="tags, comma, separated" value="${esc(tags.join(', '))}" style="flex:1;"/>
          </div>
          <div style="display:flex;justify-content:flex-end;gap:8px;">
            <span id="sp-msg-${p.id}" style="font-family:'Space Mono',monospace;font-size:10px;flex:1;"></span>
            <button class="mgmt-btn" id="sp-save-${p.id}">SAVE</button>
          </div>
        </div>`;
      list.appendChild(row);

      installTagDatalist();

      loadTrackCount(p.id).then(count => {
        const span = row.querySelector(`[data-track-count="${p.id}"]`);
        if (span) span.textContent = count === null ? 'unknown tracks' : `${count} track${count === 1 ? '' : 's'}`;
      });

      row.querySelector(`[data-preview-playlist="${p.id}"]`).addEventListener('click', () => {
        const panel = row.querySelector(`#sp-preview-${p.id}`);
        if (!panel.hidden && panel.innerHTML) {
          panel.hidden = true;
          return;
        }
        renderPlaylistPreview(p.id, row);
      });

      row.querySelector(`[data-edit-playlist="${p.id}"]`).addEventListener('click', () => {
        const form = row.querySelector(`#sp-edit-${p.id}`);
        const isHidden = form.style.display === 'none' || form.hidden;
        form.style.display = isHidden ? '' : 'none';
        form.hidden = !isHidden;
      });

      row.querySelector(`[data-del-playlist="${p.id}"]`).addEventListener('click', async () => {
        if (!confirm(`Delete smart playlist "${p.name}"?`)) return;
        await api.dashboard.schedule.smartPlaylists.remove(p.id);
        loadDashSmartPlaylists();
      });

      row.querySelector(`[data-assign-playlist="${p.id}"]`).addEventListener('click', () => {
        const addDetails = document.querySelector('.sched-add-details');
        const source = el('sched-source');
        const targetId = el('sched-target-id');
        const label = el('sched-label');
        const mode = el('sched-mode');
        const category = el('sched-category');
        if (source) source.value = 'smart_playlist';
        if (targetId) targetId.value = p.id;
        if (label && !label.value) label.value = p.name;
        if (mode) mode.value = p.mode || 'shuffle';
        if (category) category.value = '';
        if (source) source.dispatchEvent(new Event('change'));
        if (addDetails) {
          addDetails.open = true;
          addDetails.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });

      row.querySelector(`#sp-save-${p.id}`).addEventListener('click', async () => {
        const saveBtn = row.querySelector(`#sp-save-${p.id}`);
        const msgEl = row.querySelector(`#sp-msg-${p.id}`);
        const body = {
          name: row.querySelector(`#sp-name-${p.id}`).value.trim(),
          description: row.querySelector(`#sp-desc-${p.id}`).value.trim() || null,
          category: row.querySelector(`#sp-cat-${p.id}`).value || null,
          tags_filter: splitTags(row.querySelector(`#sp-tags-${p.id}`).value),
          mode: row.querySelector(`#sp-mode-${p.id}`).value,
        };
        saveBtn.disabled = true; saveBtn.textContent = '...';
        try {
          const { res, data } = await api.dashboard.schedule.smartPlaylists.update(p.id, body);
          if (res.ok) {
            saveBtn.textContent = 'OK';
            msgEl.textContent = '';
            setTimeout(() => { loadDashSmartPlaylists(); }, 800);
          } else {
            msgEl.textContent = data.error || 'Save failed';
            msgEl.style.color = '#ff6b6b';
            saveBtn.textContent = 'SAVE'; saveBtn.disabled = false;
          }
        } catch {
          msgEl.textContent = 'Network error';
          saveBtn.textContent = 'SAVE'; saveBtn.disabled = false;
        }
      });
    }
  } catch {}
}

export function initSmartPlaylistHandlers() {
  const btn = el('btn-add-smart-playlist');
  const tagsInput = el('sp-new-tags');
  if (tagsInput) {
    tagsInput.setAttribute('data-sp-tags-input', '');
    loadTagOptions().catch(() => {});
  }
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const name = el('sp-new-name').value.trim();
    const msgEl = el('sp-new-msg');
    if (!name) {
      if (msgEl) { msgEl.textContent = 'Name is required'; msgEl.style.color = '#ff6b6b'; }
      return;
    }
    const body = {
      name,
      description: el('sp-new-desc').value.trim() || null,
      category: el('sp-new-category').value || null,
      tags_filter: splitTags(el('sp-new-tags').value),
      mode: el('sp-new-mode').value,
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
