/**
 * dashboard/earnings.js — Earnings summary + audience list panel.
 *
 * Loads GET /api/dashboard/earnings (unlock revenue per track/collection,
 * tips, active subscriptions) and GET /api/dashboard/audience (consented
 * marketing contacts) into the EARNINGS dashboard section. Lazy: fetched the
 * first time the section is expanded, matching the analytics pattern.
 */

import { el, esc } from '../utils.js';
import * as api from '../api.js';
import * as dashDrawers from './drawers.js';

let loaded = false;

function dollars(cents) {
  return `$${((cents || 0) / 100).toFixed(2)}`;
}

export async function loadDashEarnings() {
  if (loaded) return;
  loaded = true;

  try {
    const d = await api.dashboard.earnings();
    const totals = d.totals || {};
    el('dash-earnings-totals').innerHTML = `
      <div class="stat-card"><div class="stat-val">${dollars(totals.revenueCents)}</div><div class="stat-key">TOTAL REVENUE</div></div>
      <div class="stat-card"><div class="stat-val">${totals.unitsSold || 0}</div><div class="stat-key">UNLOCKS SOLD</div></div>
      <div class="stat-card"><div class="stat-val">${dollars(totals.tipRevenueCents)}</div><div class="stat-key">TIPS (${totals.tipCount || 0})</div></div>
      <div class="stat-card"><div class="stat-val">${totals.activeSubscriptions || 0}</div><div class="stat-key">ACTIVE SUBS</div></div>
    `;

    const list = el('dash-earnings-list');
    const unlocks = d.unlocks || [];
    if (!unlocks.length) {
      list.innerHTML = '<div class="earnings-empty">No unlock sales yet.</div>';
    } else {
      list.innerHTML = unlocks.map(u => `
        <div class="earnings-row">
          <span class="earnings-title">${esc(u.title)}</span>
          <span class="earnings-kind">${esc(u.unlockType.replace('_', ' '))}</span>
          <span class="earnings-units">${u.unitsSold}×</span>
          <span class="earnings-amount">${dollars(u.revenueCents)}</span>
        </div>`).join('');
    }
    dashDrawers.updateEarnings(d);
  } catch {
    el('dash-earnings-totals').innerHTML = '<div class="earnings-empty">Could not load earnings.</div>';
  }

  try {
    const a = await api.dashboard.audience();
    const bySource = a.bySource || {};
    el('dash-audience-summary').innerHTML = `
      <div class="earnings-row">
        <span class="earnings-title">${a.total || 0} consented contact${a.total === 1 ? '' : 's'}</span>
        <span class="earnings-kind">${bySource.listener_profile || 0} listeners · ${bySource.download_lead || 0} leads</span>
      </div>`;
  } catch {
    el('dash-audience-summary').innerHTML = '<div class="earnings-empty">Could not load audience.</div>';
  }
}

export function initEarningsHandlers() {
  const details = el('earnings-details');
  if (details) details.addEventListener('toggle', () => { if (details.open) loadDashEarnings(); });
}
