/**
 * dashboard/posts.js — Creator posts (Patreon-style text update) management.
 */

import * as api from '../api.js';
import { el, esc } from '../utils.js';

export function init() {}

export async function loadDashPosts() {
  const list = el('dash-posts-list');
  if (!list) return;
  try {
    const posts = await api.dashboard.posts.list();

    if (!posts.length) {
      list.innerHTML = '<div style="font-size:11px;color:rgba(255,255,255,.25);font-family:\'Space Mono\',monospace;padding:8px 14px;">No posts yet.</div>';
      return;
    }

    list.innerHTML = '';
    for (const p of posts) {
      const date = new Date(p.published_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
      const row = document.createElement('div');
      row.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:9px 14px;border-radius:7px;margin-bottom:1px;">
          <div>
            <div style="font-family:'DM Serif Display',serif;font-size:15px;color:rgba(255,255,255,.78);">${esc(p.title || '(untitled)')}</div>
            <div style="font-family:'Space Mono',monospace;font-size:10px;color:rgba(255,255,255,.3);margin-top:2px;">${esc(date)} · ${esc(p.visibility.replace('_', ' '))}</div>
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <button class="mgmt-btn" data-edit-post="${p.id}">EDIT</button>
            <button class="mgmt-btn danger" data-del-post="${p.id}">DEL</button>
          </div>
        </div>
        <div class="post-edit-form" id="post-edit-${p.id}" hidden style="padding:0 14px 10px;display:none;">
          <div class="dash-form-row" style="flex-wrap:wrap;gap:6px;margin-bottom:6px;">
            <input type="text" class="dash-input dash-input-sm" id="pe-title-${p.id}" placeholder="Title (optional)…" value="${esc(p.title || '')}" style="flex:2;min-width:120px;"/>
            <select class="dash-select" id="pe-vis-${p.id}">
              <option value="public"${p.visibility === 'public' ? ' selected' : ''}>Public</option>
              <option value="supporters_only"${p.visibility === 'supporters_only' ? ' selected' : ''}>Supporters Only</option>
            </select>
          </div>
          <div class="dash-form-row" style="margin-bottom:6px;">
            <textarea class="dash-input" id="pe-body-${p.id}" rows="3" style="width:100%;resize:vertical;">${esc(p.body)}</textarea>
          </div>
          <div style="display:flex;justify-content:flex-end;gap:8px;">
            <span id="pe-msg-${p.id}" style="font-family:'Space Mono',monospace;font-size:10px;flex:1;"></span>
            <button class="mgmt-btn" id="pe-save-${p.id}">SAVE</button>
          </div>
        </div>`;
      list.appendChild(row);

      row.querySelector(`[data-edit-post="${p.id}"]`).addEventListener('click', () => {
        const form     = row.querySelector(`#post-edit-${p.id}`);
        const isHidden = form.style.display === 'none' || form.hidden;
        form.style.display = isHidden ? '' : 'none';
        form.hidden        = !isHidden;
      });

      row.querySelector(`[data-del-post="${p.id}"]`).addEventListener('click', async () => {
        if (!confirm('Delete this post?')) return;
        await api.dashboard.posts.remove(p.id);
        loadDashPosts();
      });

      row.querySelector(`#pe-save-${p.id}`).addEventListener('click', async () => {
        const saveBtn = row.querySelector(`#pe-save-${p.id}`);
        const msgEl   = row.querySelector(`#pe-msg-${p.id}`);
        const body = {
          title:      row.querySelector(`#pe-title-${p.id}`).value.trim() || null,
          body:       row.querySelector(`#pe-body-${p.id}`).value.trim(),
          visibility: row.querySelector(`#pe-vis-${p.id}`).value,
        };
        saveBtn.disabled = true; saveBtn.textContent = '…';
        try {
          const { res, data } = await api.dashboard.posts.update(p.id, body);
          if (res.ok) {
            saveBtn.textContent = '✓';
            msgEl.textContent   = '';
            setTimeout(() => { loadDashPosts(); }, 800);
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

export function initPostHandlers() {
  const btn = el('btn-add-post');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const msgEl = el('post-new-msg');
    const body = el('post-new-body').value.trim();
    if (!body) {
      if (msgEl) { msgEl.textContent = 'Body is required'; msgEl.style.color = '#ff6b6b'; }
      return;
    }
    const payload = {
      title:      el('post-new-title').value.trim() || null,
      body,
      visibility: el('post-new-visibility').value,
    };
    const { res, data } = await api.dashboard.posts.create(payload);
    if (res.ok) {
      el('post-new-title').value = '';
      el('post-new-body').value  = '';
      if (msgEl) msgEl.textContent = '';
      loadDashPosts();
    } else if (msgEl) {
      msgEl.textContent = data.error || 'Create failed';
      msgEl.style.color = '#ff6b6b';
    }
  });
}
