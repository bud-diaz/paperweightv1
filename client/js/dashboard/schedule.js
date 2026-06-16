/**
 * dashboard/schedule.js — Broadcast schedule blocks management.
 */

import * as api from '../api.js';
import { el, esc } from '../utils.js';

const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

export function init() {}

export async function loadDashSchedule() {
  try {
    const [blocks, status] = await Promise.all([
      api.dashboard.schedule.list(),
      api.stream.status().catch(() => ({})),
    ]);

    // Update mode status bar
    const mode = (status.mode || 'shuffle').toUpperCase();
    const modeEl    = el('sched-broadcast-mode');
    const toggleBtn = el('btn-sched-mode-toggle');
    if (modeEl) {
      modeEl.textContent = mode;
      modeEl.style.color = mode === 'SCHEDULED' ? '#4caf50' : '#ff9800';
    }
    if (toggleBtn) {
      if (mode === 'SCHEDULED') {
        toggleBtn.textContent    = 'SWITCH TO SHUFFLE';
        toggleBtn.style.display  = '';
      } else {
        toggleBtn.textContent    = 'ENABLE SCHEDULED MODE';
        toggleBtn.style.display  = blocks.length ? '' : 'none';
      }
      toggleBtn.onclick = async () => {
        const newMode = mode === 'SCHEDULED' ? 'shuffle' : 'scheduled';
        await api.dashboard.broadcast.setMode(newMode);
        loadDashSchedule();
      };
    }

    const list = el('dash-sched-list');
    if (!blocks.length) {
      list.innerHTML = '<div style="font-size:11px;color:rgba(255,255,255,.25);font-family:\'Space Mono\',monospace;padding:8px 14px;">No schedule blocks.</div>';
    } else {
      list.innerHTML = '';
      for (const b of blocks) {
        const dayLabel   = b.day_of_week != null ? DAY_NAMES[b.day_of_week] : 'Daily';
        const timeRange  = `${b.start_time}–${b.end_time}`;
        const label      = esc(b.label || '—');
        const targetInfo = b.target_type ? ` · ${b.target_type.replace('_', ' ')} #${b.target_id}` : '';
        const row = document.createElement('div');
        row.innerHTML = `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:9px 14px;border-radius:7px;margin-bottom:1px;">
            <div>
              <div style="font-family:'DM Serif Display',serif;font-size:15px;color:rgba(255,255,255,.78);">${label}</div>
              <div style="font-family:'Space Mono',monospace;font-size:10px;color:rgba(255,255,255,.3);margin-top:2px;">${dayLabel} · ${timeRange} · ${b.category||'any'} · ${b.mode}${targetInfo}</div>
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
              <button class="mgmt-btn" data-edit-block="${b.id}">EDIT</button>
              <button class="mgmt-btn danger" data-del-block="${b.id}">DEL</button>
            </div>
          </div>
          <div class="sched-edit-form" id="sched-edit-${b.id}" hidden style="padding:0 14px 10px;display:none;">
            <div class="dash-form-row" style="flex-wrap:wrap;gap:6px;margin-bottom:6px;">
              <input type="text" class="dash-input dash-input-sm" id="se-label-${b.id}" placeholder="Label…" value="${esc(b.label||'')}" style="flex:2;min-width:80px;"/>
              <select class="dash-select" id="se-day-${b.id}">
                <option value="">Daily</option>
                <option value="0"${b.day_of_week===0?' selected':''}>Sun</option>
                <option value="1"${b.day_of_week===1?' selected':''}>Mon</option>
                <option value="2"${b.day_of_week===2?' selected':''}>Tue</option>
                <option value="3"${b.day_of_week===3?' selected':''}>Wed</option>
                <option value="4"${b.day_of_week===4?' selected':''}>Thu</option>
                <option value="5"${b.day_of_week===5?' selected':''}>Fri</option>
                <option value="6"${b.day_of_week===6?' selected':''}>Sat</option>
              </select>
              <input type="time" class="dash-input dash-input-sm" id="se-start-${b.id}" value="${esc(b.start_time||'')}"/>
              <input type="time" class="dash-input dash-input-sm" id="se-end-${b.id}" value="${esc(b.end_time||'')}"/>
              <select class="dash-select" id="se-cat-${b.id}">
                <option value="">Any</option>
                <option value="music"${b.category==='music'?' selected':''}>Music</option>
                <option value="beats"${b.category==='beats'?' selected':''}>Beats</option>
                <option value="podcasts"${b.category==='podcasts'?' selected':''}>Podcasts</option>
                <option value="videos"${b.category==='videos'?' selected':''}>Videos</option>
              </select>
              <select class="dash-select" id="se-mode-${b.id}">
                <option value="shuffle"${b.mode==='shuffle'?' selected':''}>Shuffle</option>
                <option value="sequential"${b.mode==='sequential'?' selected':''}>Sequential</option>
              </select>
            </div>
            <div class="dash-form-row" style="gap:6px;margin-bottom:6px;">
              <select class="dash-select" id="se-src-${b.id}" style="min-width:140px;">
                <option value="">From category</option>
                <option value="vault_item"${b.target_type==='vault_item'?' selected':''}>Vault item</option>
                <option value="vault_project"${b.target_type==='vault_project'?' selected':''}>Vault project</option>
              </select>
              <input type="number" class="dash-input dash-input-sm" id="se-tid-${b.id}" placeholder="Target ID" value="${b.target_id||''}" style="width:100px;"/>
            </div>
            <div style="display:flex;justify-content:flex-end;gap:8px;">
              <span id="se-msg-${b.id}" style="font-family:'Space Mono',monospace;font-size:10px;flex:1;"></span>
              <button class="mgmt-btn" id="se-save-${b.id}">SAVE</button>
            </div>
          </div>`;
        list.appendChild(row);

        row.querySelector(`[data-edit-block="${b.id}"]`).addEventListener('click', () => {
          const form     = row.querySelector(`#sched-edit-${b.id}`);
          const isHidden = form.style.display === 'none' || form.hidden;
          form.style.display = isHidden ? '' : 'none';
          form.hidden        = !isHidden;
        });

        row.querySelector(`[data-del-block="${b.id}"]`).addEventListener('click', async () => {
          await api.dashboard.schedule.deleteBlock(b.id);
          loadDashSchedule();
        });

        row.querySelector(`#se-save-${b.id}`).addEventListener('click', async () => {
          const saveBtn = row.querySelector(`#se-save-${b.id}`);
          const msgEl   = row.querySelector(`#se-msg-${b.id}`);
          const dayVal  = row.querySelector(`#se-day-${b.id}`).value;
          const srcType = row.querySelector(`#se-src-${b.id}`).value;
          const tidVal  = row.querySelector(`#se-tid-${b.id}`).value;
          const body = {
            label:       row.querySelector(`#se-label-${b.id}`).value.trim() || null,
            day_of_week: dayVal !== '' ? parseInt(dayVal, 10) : null,
            start_time:  row.querySelector(`#se-start-${b.id}`).value,
            end_time:    row.querySelector(`#se-end-${b.id}`).value,
            category:    row.querySelector(`#se-cat-${b.id}`).value || null,
            mode:        row.querySelector(`#se-mode-${b.id}`).value,
            target_type: srcType || null,
            target_id:   srcType && tidVal ? parseInt(tidVal, 10) : null,
          };
          saveBtn.disabled = true; saveBtn.textContent = '…';
          try {
            const { res } = await api.dashboard.schedule.updateBlock(b.id, body);
            if (res.ok) {
              saveBtn.textContent = '✓';
              msgEl.textContent   = '';
              setTimeout(() => { loadDashSchedule(); }, 800);
            } else {
              const d = await res.json().catch(() => ({}));
              msgEl.textContent = d.error || 'Save failed';
              msgEl.style.color = '#ff6b6b';
              saveBtn.textContent = 'SAVE'; saveBtn.disabled = false;
            }
          } catch {
            msgEl.textContent   = 'Network error';
            saveBtn.textContent = 'SAVE'; saveBtn.disabled = false;
          }
        });
      }
    }
  } catch {}
}

export function initScheduleHandlers() {
  el('btn-add-sched').addEventListener('click', async () => {
    const dayVal  = el('sched-day').value;
    const srcType = el('sched-source') ? el('sched-source').value : '';
    const tidVal  = el('sched-target-id') ? el('sched-target-id').value : '';
    const body    = {
      label:       el('sched-label').value.trim() || null,
      day_of_week: dayVal !== '' ? parseInt(dayVal, 10) : null,
      start_time:  el('sched-start').value,
      end_time:    el('sched-end').value,
      category:    el('sched-category').value || null,
      mode:        el('sched-mode').value,
      target_type: srcType || null,
      target_id:   srcType && tidVal ? parseInt(tidVal, 10) : null,
    };
    if (!body.start_time || !body.end_time) return;
    await api.dashboard.schedule.createBlock(body);
    loadDashSchedule();
  });
}
