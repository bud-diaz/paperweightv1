/**
 * dashboard/schedule.js - Broadcast schedule blocks management.
 */

import * as api from '../api.js';
import { el, esc, fmt } from '../utils.js';
import { isDesktopPlatform } from './index.js';

const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

export function init() {}

function sourceLabel(type, id) {
  if (!type) return '';
  if (type === 'smart_playlist') return `smart playlist #${id}`;
  return 'unsupported source';
}

function supportedSource(type) {
  return type === 'smart_playlist';
}

function syncTargetInput(sourceEl, targetEl) {
  if (!sourceEl || !targetEl) return;
  const needsTarget = sourceEl.value === 'smart_playlist';
  targetEl.disabled = !needsTarget;
  targetEl.placeholder = needsTarget ? 'Smart playlist ID' : 'Not needed';
  if (!needsTarget) targetEl.value = '';
}

function selectSourceOptions(currentType) {
  const normalized = supportedSource(currentType) ? currentType : '';
  return `
    <option value=""${normalized === '' ? ' selected' : ''}>From category</option>
    <option value="smart_playlist"${normalized === 'smart_playlist' ? ' selected' : ''}>Smart playlist</option>
  `;
}

function timeRangeLabel(start, end) {
  const opts = { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };
  return `${start.toLocaleString(undefined, opts)} - ${end.toLocaleString(undefined, opts)}`;
}

function localDatetimeValue(date) {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return shifted.toISOString().slice(0, 16);
}

function dateFromLocalInput(value) {
  return value ? new Date(value) : null;
}

function setPreviewPreset(hours) {
  const from = new Date();
  const to = new Date(from.getTime() + hours * 3600 * 1000);
  const fromEl = el('sched-preview-from');
  const toEl = el('sched-preview-to');
  if (fromEl) fromEl.value = localDatetimeValue(from);
  if (toEl) toEl.value = localDatetimeValue(to);
}

function previewRange() {
  const fromEl = el('sched-preview-from');
  const toEl = el('sched-preview-to');
  let from = dateFromLocalInput(fromEl?.value);
  let to = dateFromLocalInput(toEl?.value);
  if (!from || Number.isNaN(from.getTime())) from = new Date();
  if (!to || Number.isNaN(to.getTime()) || to <= from) {
    to = new Date(from.getTime() + 24 * 3600 * 1000);
  }
  return { from, to };
}

export async function loadDashSchedule() {
  try {
    const [blocks, status] = await Promise.all([
      api.dashboard.schedule.list(),
      api.stream.status().catch(() => ({})),
    ]);

    const mode = (status.mode || 'shuffle').toUpperCase();
    const modeEl = el('sched-broadcast-mode');
    const toggleBtn = el('btn-sched-mode-toggle');
    if (modeEl) {
      modeEl.textContent = mode;
      modeEl.style.color = mode === 'SCHEDULED' ? '#4caf50' : '#ff9800';
    }
    if (toggleBtn) {
      if (mode === 'SCHEDULED') {
        toggleBtn.textContent = 'SWITCH TO SHUFFLE';
        toggleBtn.style.display = '';
      } else {
        toggleBtn.textContent = 'ENABLE SCHEDULED MODE';
        toggleBtn.style.display = blocks.length ? '' : 'none';
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
        const dayLabel = b.day_of_week != null ? DAY_NAMES[b.day_of_week] : 'Daily';
        const timeRange = `${b.start_time}-${b.end_time}`;
        const label = esc(b.label || '-');
        const targetInfo = supportedSource(b.target_type) ? ` / ${sourceLabel(b.target_type, b.target_id)}` : '';
        const unsupported = b.target_type && !supportedSource(b.target_type)
          ? ' / source not supported by UI'
          : '';
        const canEdit = isDesktopPlatform();
        const row = document.createElement('div');
        row.innerHTML = `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:9px 14px;border-radius:7px;margin-bottom:1px;">
            <div>
              <div style="font-family:'DM Serif Display',serif;font-size:15px;color:rgba(255,255,255,.78);">${label}</div>
              <div style="font-family:'Space Mono',monospace;font-size:10px;color:rgba(255,255,255,.3);margin-top:2px;">${dayLabel} / ${timeRange} / ${b.category || 'any'} / ${b.mode}${targetInfo}${unsupported}</div>
            </div>
            ${canEdit ? `
            <div style="display:flex;align-items:center;gap:8px;">
              <button class="mgmt-btn" data-edit-block="${b.id}">EDIT</button>
              <button class="mgmt-btn danger" data-del-block="${b.id}">DEL</button>
            </div>` : ''}
          </div>
          ${canEdit ? `
          <div class="sched-edit-form" id="sched-edit-${b.id}" hidden style="padding:0 14px 10px;display:none;">
            <div class="dash-form-row" style="flex-wrap:wrap;gap:6px;margin-bottom:6px;">
              <input type="text" class="dash-input dash-input-sm" id="se-label-${b.id}" placeholder="Label..." value="${esc(b.label||'')}" style="flex:2;min-width:80px;"/>
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
                ${selectSourceOptions(b.target_type)}
              </select>
              <input type="number" class="dash-input dash-input-sm" id="se-tid-${b.id}" placeholder="Target ID" value="${supportedSource(b.target_type) ? b.target_id || '' : ''}" style="width:120px;"/>
            </div>
            <div style="display:flex;justify-content:flex-end;gap:8px;">
              <span id="se-msg-${b.id}" style="font-family:'Space Mono',monospace;font-size:10px;flex:1;"></span>
              <button class="mgmt-btn" id="se-save-${b.id}">SAVE</button>
            </div>
          </div>` : ''}`;
        list.appendChild(row);

        if (!canEdit) continue;

        const sourceEl = row.querySelector(`#se-src-${b.id}`);
        const targetEl = row.querySelector(`#se-tid-${b.id}`);
        syncTargetInput(sourceEl, targetEl);
        sourceEl.addEventListener('change', () => syncTargetInput(sourceEl, targetEl));

        row.querySelector(`[data-edit-block="${b.id}"]`).addEventListener('click', () => {
          const form = row.querySelector(`#sched-edit-${b.id}`);
          const isHidden = form.style.display === 'none' || form.hidden;
          form.style.display = isHidden ? '' : 'none';
          form.hidden = !isHidden;
        });

        row.querySelector(`[data-del-block="${b.id}"]`).addEventListener('click', async () => {
          await api.dashboard.schedule.deleteBlock(b.id);
          loadDashSchedule();
        });

        row.querySelector(`#se-save-${b.id}`).addEventListener('click', async () => {
          const saveBtn = row.querySelector(`#se-save-${b.id}`);
          const msgEl = row.querySelector(`#se-msg-${b.id}`);
          const dayVal = row.querySelector(`#se-day-${b.id}`).value;
          const srcType = row.querySelector(`#se-src-${b.id}`).value;
          const tidVal = row.querySelector(`#se-tid-${b.id}`).value;
          const body = {
            label: row.querySelector(`#se-label-${b.id}`).value.trim() || null,
            day_of_week: dayVal !== '' ? parseInt(dayVal, 10) : null,
            start_time: row.querySelector(`#se-start-${b.id}`).value,
            end_time: row.querySelector(`#se-end-${b.id}`).value,
            category: row.querySelector(`#se-cat-${b.id}`).value || null,
            mode: row.querySelector(`#se-mode-${b.id}`).value,
            target_type: srcType || null,
            target_id: srcType && tidVal ? parseInt(tidVal, 10) : null,
          };
          saveBtn.disabled = true; saveBtn.textContent = '...';
          try {
            const { res, data } = await api.dashboard.schedule.updateBlock(b.id, body);
            if (res.ok) {
              saveBtn.textContent = 'OK';
              msgEl.textContent = '';
              setTimeout(() => { loadDashSchedule(); }, 800);
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
    }
  } catch {}
}

export async function loadDashSchedulePreview() {
  const list = el('dash-sched-preview-list');
  if (!list || !isDesktopPlatform()) return;
  const { from, to } = previewRange();
  list.innerHTML = '<div style="font-size:11px;color:rgba(255,255,255,.25);font-family:\'Space Mono\',monospace;padding:8px 14px;">Loading...</div>';
  try {
    const data = await api.dashboard.schedule.preview(from.toISOString(), 24, to.toISOString());
    if (!data.segments.length) {
      list.innerHTML = '<div style="font-size:11px;color:rgba(255,255,255,.25);font-family:\'Space Mono\',monospace;padding:8px 14px;">No segments in this range.</div>';
      return;
    }
    list.innerHTML = '';
    for (const seg of data.segments) {
      const start = new Date(seg.startTime || seg.start);
      const end = new Date(seg.endTime || seg.end);
      const label = seg.block ? (seg.block.label || `Block #${seg.block.id}`) : 'Shuffle (no block)';
      const tracks = Array.isArray(seg.tracks) ? seg.tracks : [];
      const totalDuration = tracks.reduce((sum, t) => sum + (Number(t.duration) || 0), 0);
      const detail = seg.block
        ? `${seg.block.mode}${seg.block.target_type ? ' / ' + sourceLabel(seg.block.target_type, seg.block.target_id) : (seg.block.category ? ' / ' + seg.block.category : '')}`
        : 'fallback shuffle';
      const row = document.createElement('div');
      row.className = 'sched-preview-row';
      row.innerHTML = `
        <div class="sched-preview-head">
          <div>
            <div class="sched-preview-title">${esc(label)}</div>
            <div class="sched-preview-meta">${esc(detail)} / ${tracks.length} track${tracks.length === 1 ? '' : 's'}${totalDuration ? ' / ' + fmt(totalDuration) : ''}</div>
          </div>
          <div class="sched-preview-time">${esc(timeRangeLabel(start, end))}</div>
        </div>
        <details class="sched-preview-tracks"${tracks.length ? '' : ' hidden'}>
          <summary class="dash-summary">TRACKS</summary>
          ${tracks.length
            ? tracks.map((track, idx) => `<div class="sched-preview-track">${idx + 1}. ${esc(track.title || track.filename || `Track #${track.id}`)}${track.duration ? ' / ' + fmt(track.duration) : ''}</div>`).join('')
            : '<div class="sched-preview-track">No matching tracks.</div>'}
        </details>`;
      list.appendChild(row);
    }
  } catch {
    list.innerHTML = '<div style="font-size:11px;color:#ff6b6b;font-family:\'Space Mono\',monospace;padding:8px 14px;">Failed to load preview.</div>';
  }
}

export function initScheduleHandlers() {
  const source = el('sched-source');
  const target = el('sched-target-id');
  syncTargetInput(source, target);
  if (source) source.addEventListener('change', () => syncTargetInput(source, target));

  const previewBtn = el('btn-sched-preview-refresh');
  if (previewBtn) previewBtn.addEventListener('click', loadDashSchedulePreview);
  const preset24 = el('btn-sched-preview-24h');
  if (preset24) preset24.addEventListener('click', () => { setPreviewPreset(24); loadDashSchedulePreview(); });
  const preset7 = el('btn-sched-preview-7d');
  if (preset7) preset7.addEventListener('click', () => { setPreviewPreset(24 * 7); loadDashSchedulePreview(); });
  setPreviewPreset(24);

  const addBtn = el('btn-add-sched');
  if (!addBtn) return;
  addBtn.addEventListener('click', async () => {
    const dayVal = el('sched-day').value;
    const srcType = source ? source.value : '';
    const tidVal = target ? target.value : '';
    const body = {
      label: el('sched-label').value.trim() || null,
      day_of_week: dayVal !== '' ? parseInt(dayVal, 10) : null,
      start_time: el('sched-start').value,
      end_time: el('sched-end').value,
      category: el('sched-category').value || null,
      mode: el('sched-mode').value,
      target_type: srcType || null,
      target_id: srcType && tidVal ? parseInt(tidVal, 10) : null,
    };
    if (!body.start_time || !body.end_time) return;
    await api.dashboard.schedule.createBlock(body);
    loadDashSchedule();
  });
}
