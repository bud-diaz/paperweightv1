/**
 * dashboard/analytics.js — Analytics, play counts, and tip config.
 */

import * as api from '../api.js';
import { el, esc } from '../utils.js';

// ── Module-local state ─────────────────────────────────────────────────────────
let _analyticsExpandedLoaded = false;

// ── Injected callbacks ─────────────────────────────────────────────────────────
let _buildTipPresets = () => {};

export function init(callbacks = {}) {
  if (callbacks.buildTipPresets) _buildTipPresets = callbacks.buildTipPresets;
}

// ── Live analytics ─────────────────────────────────────────────────────────────
export async function loadDashAnalytics() {
  try {
    const [liveData, topData] = await Promise.all([
      api.analytics.live(),
      api.analytics.top(3),
    ]);
    el('dash-analytics').innerHTML =
      `<div class="stat-card"><div class="stat-val">${liveData.currentListeners||0}</div><div class="stat-key">NOW</div></div>` +
      `<div class="stat-card"><div class="stat-val">${liveData.peakToday||0}</div><div class="stat-key">PEAK TODAY</div></div>` +
      (topData.length
        ? `<div class="stat-card"><div class="stat-key" style="margin-bottom:6px;">TOP TRACKS</div>${
            topData.map(t => `<div style="font-size:10px;color:rgba(255,255,255,.45);padding:1px 0;font-family:'Space Mono',monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(t.title||t.filename)}</div>`).join('')
          }</div>` : '');
  } catch {}
}

// ── Expanded analytics (7-day history + top 5) ────────────────────────────────
export async function loadAnalyticsExpanded() {
  if (_analyticsExpandedLoaded) return;
  _analyticsExpandedLoaded = true;
  try {
    const [histData, topData] = await Promise.all([
      api.analytics.history(7),
      api.analytics.top(5, '30d'),
    ]);
    // 7-day bar chart
    const barsEl = el('analytics-history-bars');
    if (histData.length) {
      const maxListeners = Math.max(1, ...histData.map(d => d.unique_listeners));
      barsEl.innerHTML = histData.map(d => {
        const h     = Math.max(8, Math.round((d.unique_listeners / maxListeners) * 100));
        const label = new Date(d.date).toLocaleDateString('en-US', { weekday: 'short' });
        return `<div class="analytics-history-bar" title="${label}: ${d.unique_listeners} listeners" style="height:${h}%;"></div>`;
      }).join('');
    } else {
      barsEl.innerHTML = '<div style="font-family:\'Space Mono\',monospace;font-size:10px;color:var(--t4);">No data yet</div>';
    }
    // Top tracks
    const topEl = el('analytics-top-list');
    if (topData.length) {
      topEl.innerHTML = topData.map((t) =>
        `<div class="analytics-top-row">
          <div class="analytics-top-title">${esc(t.title||t.filename)}</div>
          <div class="analytics-top-count">▶ ${t.play_count}</div>
        </div>`
      ).join('');
    } else {
      topEl.innerHTML = '<div style="font-family:\'Space Mono\',monospace;font-size:10px;color:var(--t4);">No plays recorded yet</div>';
    }
  } catch {}
}

// ── Tip config ─────────────────────────────────────────────────────────────────
export async function loadDashTipConfig() {
  try {
    const d    = await api.dashboard.tipConfig.get();
    const amts = d.amounts || [300, 500, 1000];
    el('tip-cfg-1').value        = (amts[0] || 300) / 100;
    el('tip-cfg-2').value        = (amts[1] || 500) / 100;
    el('tip-cfg-3').value        = (amts[2] || 1000) / 100;
    el('tip-cfg-custom').checked = !!d.customEnabled;
  } catch {}
}

// ── Play counts ────────────────────────────────────────────────────────────────
export async function loadPlayCounts() {
  try {
    const data = await api.analytics.playcounts();
    window._playCounts = data;
    document.querySelectorAll('[id^="plays-"]').forEach(elNode => {
      const id = elNode.id.replace('plays-', '');
      elNode.textContent = '▶ ' + (data[id] || 0);
    });
  } catch {}
}

// ── Analytics event handlers ───────────────────────────────────────────────────
export function initAnalyticsHandlers() {
  el('analytics-details').addEventListener('toggle', () => {
    if (el('analytics-details').open) loadAnalyticsExpanded();
  });

  el('btn-save-tip-cfg').addEventListener('click', async () => {
    const amounts = [
      Math.round(parseFloat(el('tip-cfg-1').value) * 100),
      Math.round(parseFloat(el('tip-cfg-2').value) * 100),
      Math.round(parseFloat(el('tip-cfg-3').value) * 100),
    ];
    const customEnabled = el('tip-cfg-custom').checked;
    const msg = el('tip-cfg-msg');
    try {
      const { res } = await api.dashboard.tipConfig.update({ amounts, customEnabled });
      if (res.ok) {
        msg.className   = 'dash-success-msg';
        msg.textContent = 'SAVED';
        _buildTipPresets(amounts);
        setTimeout(() => { msg.textContent = ''; }, 2000);
      } else { throw new Error(); }
    } catch {
      msg.className   = 'dash-error-msg';
      msg.textContent = 'FAILED';
    }
  });
}
