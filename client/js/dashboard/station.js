/**
 * dashboard/station.js — Station registration, health, and URL management.
 */

import * as api from '../api.js';
import { el, esc } from '../utils.js';

export function init() {}

export async function loadDashStation() {
  try {
    const data = await api.dashboard.station.get();
    if (!data.slug) {
      el('station-unclaimed').hidden   = false;
      el('station-reg-content').hidden = true;
      return;
    }
    el('station-unclaimed').hidden   = true;
    el('station-reg-content').hidden = false;
    el('station-public-url').textContent    = data.url || '';
    el('station-url-input').placeholder     = data.url || 'https://radio.yoursite.com';

    el('btn-copy-url').onclick = () => {
      navigator.clipboard?.writeText(data.url).catch(() => {});
      el('btn-copy-url').textContent = 'COPIED';
      setTimeout(() => { el('btn-copy-url').textContent = 'COPY'; }, 2000);
    };

    checkStationHealth();
  } catch {}
}

export async function checkStationHealth() {
  const dot    = el('health-dot');
  const status = el('health-status');
  dot.style.background = 'rgba(255,255,255,.25)';
  status.textContent   = 'Checking…';
  status.style.color   = 'rgba(255,255,255,.3)';
  try {
    const res = await api.dashboard.station.health();
    if (res.reachable === true) {
      dot.style.background = '#39ff14';
      status.textContent   = `Reachable · ${res.latencyMs}ms`;
      status.style.color   = '#39ff14';
    } else {
      dot.style.background = '#ff4466';
      status.textContent   = res.error ? `Unreachable — ${res.error}` : 'Unreachable';
      status.style.color   = '#ff4466';
    }
  } catch {
    dot.style.background = 'rgba(255,255,255,.2)';
    status.textContent   = 'Check failed';
  }
}

export function initStationHandlers() {
  el('btn-recheck-health').addEventListener('click', checkStationHealth);

  el('btn-update-url').addEventListener('click', async () => {
    const url = el('station-url-input').value.trim();
    const msg = el('station-url-msg');
    if (!url) return;
    const { res, data } = await api.dashboard.station.updateUrl(url);
    if (res.ok) {
      msg.className   = 'dash-success-msg';
      msg.textContent = 'URL updated.';
      el('station-public-url').textContent = url;
      setTimeout(() => { msg.textContent = ''; }, 3000);
      checkStationHealth();
    } else {
      msg.className   = 'dash-error-msg';
      msg.textContent = data.error || 'Update failed';
    }
  });
}
