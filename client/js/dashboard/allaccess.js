/**
 * dashboard/allaccess.js — All-Access tier pricing & subscriber-inclusion config.
 */

import * as api from '../api.js';
import { el, isValidCentsInput } from '../utils.js';

function setRecurringFieldVisibility() {
  const isRecurring = el('aa-payment-type').value === 'recurring';
  el('aa-interval-row').hidden = !isRecurring;
}

// ── Load current config ─────────────────────────────────────────────────────
export async function loadDashAllAccess() {
  try {
    const pricing = await api.dashboard.vault.pricing();
    const aa = pricing.allAccess || {};
    el('aa-enabled').checked              = !!aa.enabled;
    el('aa-subscribers-included').checked = !!aa.subscribers_included;
    el('aa-sugg').value = aa.suggested_price != null ? (aa.suggested_price / 100).toFixed(2) : '';
    el('aa-min').value  = aa.minimum_price   != null ? (aa.minimum_price   / 100).toFixed(2) : '';
    el('aa-free').checked = !!aa.allow_free;
    el('aa-payment-type').value = aa.payment_type || 'recurring';
    el('aa-interval').value     = aa.recurring_interval || 'monthly';
    setRecurringFieldVisibility();
  } catch {
    el('aa-msg').style.color = '#ff6b6b';
    el('aa-msg').textContent = 'Failed to load All-Access config';
  }
}

// ── Save handler ─────────────────────────────────────────────────────────────
export function initAllAccessHandlers() {
  el('aa-payment-type').addEventListener('change', setRecurringFieldVisibility);

  el('btn-aa-save').addEventListener('click', async () => {
    const msgEl = el('aa-msg');
    const enabled             = el('aa-enabled').checked;
    const subscribersIncluded = el('aa-subscribers-included').checked;
    const suggInput  = el('aa-sugg').value;
    const minInput    = el('aa-min').value;
    const allowFree   = el('aa-free').checked;
    const paymentType = el('aa-payment-type').value;
    const interval     = el('aa-interval').value;

    if (!isValidCentsInput(suggInput) || !isValidCentsInput(minInput)) {
      msgEl.style.color = '#ff6b6b';
      msgEl.textContent = 'Prices must be whole cents (max 2 decimal places)';
      return;
    }
    const suggRaw = parseFloat(suggInput) || 0;
    const minRaw  = parseFloat(minInput)  || 0;
    if (enabled && !allowFree && minRaw < 0.01) {
      msgEl.style.color = '#ff6b6b';
      msgEl.textContent = 'Minimum must be ≥ $0.01 when free is disabled';
      return;
    }

    const { res } = await api.dashboard.vault.setAllAccess({
      enabled,
      subscribers_included: subscribersIncluded,
      suggested_price: Math.round(suggRaw * 100),
      minimum_price:   Math.round(minRaw  * 100),
      allow_free:      allowFree,
      payment_type:    paymentType,
      recurring_interval: paymentType === 'recurring' ? interval : null,
    });

    if (res.ok) {
      msgEl.style.color = 'rgba(255,255,255,.5)';
      msgEl.textContent = '✓ SAVED';
      setTimeout(() => { msgEl.textContent = ''; }, 2500);
    } else {
      msgEl.style.color = '#ff6b6b';
      msgEl.textContent = 'Save failed';
    }
  });
}
