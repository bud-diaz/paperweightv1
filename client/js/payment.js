/**
 * payment.js — Support modal (tip/subscribe/all-access), vault gate, floating tip.
 *
 * Exports: openModal, closeModal, setModalTab, buildTipPresets, loadTipConfig,
 *          checkVaultGate, startVaultUnlock, handleTippedParam,
 *          initPaymentHandlers, initFloatingTip.
 *
 * All Stripe redirect flows go through api.payment.* — no raw fetch calls here.
 *
 * checkVaultGate(t): reads unlock options, renders the gate UI, returns boolean.
 *   It is "read-only" in the sense that it fetches options and displays choices
 *   without initiating any payment. The actual checkout redirect lives in
 *   startVaultUnlock().
 *
 * Modal state that stays module-local (not in state.js):
 *   tipAmounts      — loaded once from server, only payment.js reads/writes it.
 *   selectedTipCents — transient UI selection, reset on closeModal.
 *   Both are primitives that are whole-reassigned, so they can't be exported
 *   live bindings from state.js anyway.
 *
 * Injected callbacks (registered via init() to avoid circular imports):
 *   _getStationName  — hls-client.js (openModal uses station name in heading)
 *   _render          — player.js (handleTippedParam / vault gate login hint)
 *   _setAuthTab      — auth.js
 *   _toggleAuthSection — auth.js
 */

import { state, authState } from './state.js';
import { el, esc } from './utils.js';
import * as api from './api.js';

// ── Module-local state ────────────────────────────────────────────────────────

let tipAmounts       = [];
let selectedTipCents = null;

// ── Injected callbacks ────────────────────────────────────────────────────────

let _getStationName    = () => '';
let _render            = () => {};
let _setAuthTab        = () => {};
let _toggleAuthSection = () => {};

/**
 * Register cross-module callbacks.
 * Called from main.js in Phase 8 before any UI interaction occurs.
 *
 * @param {{ getStationName, render, setAuthTab, toggleAuthSection }} cbs
 */
export function init({
  getStationName,
  render,
  setAuthTab,
  toggleAuthSection,
} = {}) {
  if (getStationName)    _getStationName    = getStationName;
  if (render)            _render            = render;
  if (setAuthTab)        _setAuthTab        = setAuthTab;
  if (toggleAuthSection) _toggleAuthSection = toggleAuthSection;
}

// ── Tip config ────────────────────────────────────────────────────────────────

export async function loadTipConfig() {
  try {
    const cfg = await api.payment.tipConfig();
    tipAmounts = (cfg.enabled && cfg.amounts?.length) ? cfg.amounts : [300, 500, 1000];
  } catch {
    tipAmounts = [300, 500, 1000];
  }
  buildTipPresets();
}

/**
 * Update the in-memory tip preset amounts without re-fetching from the server.
 * Added in Phase 8 so dashboard/analytics.js's "save tip config" handler can
 * refresh the listener-facing tip presets immediately after a successful save,
 * via main.js's analytics.init({ buildTipPresets: ... }) wiring. tipAmounts is
 * intentionally module-local (see header comment); this is the minimal setter
 * needed to let another module request an update without owning the state.
 *
 * @param {number[]} amounts
 */
export function setTipAmounts(amounts) {
  if (Array.isArray(amounts) && amounts.length) tipAmounts = amounts;
}

export function buildTipPresets() {
  const presetsEl = el('tip-presets');
  presetsEl.innerHTML = tipAmounts.map(cents => {
    const label = cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
    return `<button class="tip-preset" data-cents="${cents}">${label}</button>`;
  }).join('');
  presetsEl.querySelectorAll('.tip-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      presetsEl.querySelectorAll('.tip-preset').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedTipCents = parseInt(btn.dataset.cents, 10);
      el('tip-amount').value = (selectedTipCents / 100).toFixed(2);
      _updateCTA();
    });
  });
}

// ── Modal ─────────────────────────────────────────────────────────────────────

export function openModal() {
  const name = _getStationName();
  el('modal-creator-name').textContent = name ? `Support ${name}` : 'Support this station';
  el('modal-creator-show').textContent = name.toUpperCase();
  el('modal-backdrop').classList.add('open');
  setModalTab('tip');
}

export function closeModal() {
  el('modal-backdrop').classList.remove('open');
  el('modal-done').style.display = 'none';
  el('modal-main').style.display = '';
  el('tip-amount').value         = '';
  selectedTipCents               = null;
  document.querySelectorAll('.tip-preset').forEach(p => p.classList.remove('active'));
  _updateCTA();
}

export function setModalTab(id) {
  document.querySelectorAll('.modal-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === id));
  document.querySelectorAll('.tab-pane').forEach(p =>
    p.classList.toggle('active', p.dataset.pane === id));
  _updateCTA();
}

function _updateCTA() {
  const cta = el('modal-cta');
  const tab = document.querySelector('.modal-tab.active')?.dataset.tab || 'tip';
  const amt = parseFloat(el('tip-amount').value);
  cta.classList.remove('processing');
  if (tab === 'tip') {
    cta.textContent = amt > 0 ? `SEND $${amt.toFixed(2)} TIP` : 'SEND TIP';
    cta.disabled    = !(amt > 0);
  } else if (tab === 'subscribe') {
    cta.textContent = 'SUBSCRIBE';
    cta.disabled    = false;
  } else {
    cta.textContent = 'GET ALL-ACCESS';
    cta.disabled    = false;
  }
}

async function _handleCtaClick() {
  const cta = el('modal-cta');
  const tab = document.querySelector('.modal-tab.active')?.dataset.tab || 'tip';

  if (tab === 'tip') {
    const rawAmt = parseFloat(el('tip-amount').value);
    const cents  = selectedTipCents || (rawAmt > 0 ? Math.round(rawAmt * 100) : 0);
    if (!cents || cents < 100) return;

    cta.classList.add('processing');
    cta.textContent = 'CONNECTING TO STRIPE…';
    try {
      const { res, data } = await api.payment.sendTip(cents);
      if (!res.ok) throw new Error(data.error || 'Payment failed');
      window.location.href = data.checkoutUrl;
    } catch (err) {
      cta.classList.remove('processing');
      _updateCTA();
      const errEl = document.createElement('div');
      errEl.style.cssText = 'font-family:Space Mono,monospace;font-size:12px;color:#ff4466;margin-top:8px;text-align:center;';
      errEl.textContent = err.message;
      el('modal-body').appendChild(errEl);
      setTimeout(() => errEl.remove(), 4000);
    }
  } else {
    const tier = tab === 'all-access' ? 'all_access' : 'subscriber';
    cta.classList.add('processing');
    cta.textContent = 'CONNECTING TO STRIPE…';
    try {
      const data = await api.payment.checkoutUrl(tier);
      if (!data.checkoutUrl) throw new Error(data.error || 'Failed');
      window.location.href = data.checkoutUrl;
    } catch {
      cta.classList.remove('processing');
      _updateCTA();
    }
  }
}

// ── ?tipped=1 URL param handling (Stripe redirect) ────────────────────────────

export function handleTippedParam() {
  const params = new URLSearchParams(location.search);
  if (!params.has('tipped')) return;
  params.delete('tipped');
  const clean = location.pathname + (params.toString() ? '?' + params : '') + location.hash;
  history.replaceState(null, '', clean);

  el('modal-done').style.display     = 'block';
  el('modal-main').style.display     = 'none';
  el('modal-done-icon').textContent  = '✦';
  el('modal-done-title').textContent = 'Thank you.';
  const name = _getStationName();
  el('modal-done-msg').textContent   = name
    ? `Your support keeps ${name} independent.`
    : 'Your support is appreciated.';
  el('modal-backdrop').classList.add('open');
  setTimeout(closeModal, 5000);

  if (!authState.loggedIn) {
    const nudge = document.createElement('p');
    nudge.style.cssText = 'margin:12px 0 0;font-family:"Space Mono",monospace;font-size:11px;color:rgba(255,255,255,.35);text-align:center;line-height:1.5;';
    nudge.textContent = 'Create a free account to save your access.';
    const nudgeBtn = document.createElement('button');
    nudgeBtn.style.cssText = 'margin-top:8px;background:none;border:1px solid rgba(255,255,255,.18);border-radius:5px;padding:5px 14px;font-family:"Space Mono",monospace;font-size:10px;letter-spacing:.05em;color:rgba(255,255,255,.45);cursor:pointer;display:block;margin-left:auto;margin-right:auto;';
    nudgeBtn.textContent = 'CREATE ACCOUNT';
    nudgeBtn.addEventListener('click', () => {
      closeModal();
      _setAuthTab('register');
      state.showShare = true;
      state.sharePanel = 'account';
      _render();
      _toggleAuthSection(true);
      setTimeout(() => el('auth-email').focus(), 120);
    });
    el('modal-done').appendChild(nudge);
    el('modal-done').appendChild(nudgeBtn);
  }
}

// ── Vault gate ────────────────────────────────────────────────────────────────

/**
 * Read-only vault check. Fetches unlock options for track t.
 * If the track is gated and not already unlocked, renders the vault gate UI
 * (showing available unlock options) and returns true.
 * Returns false if the track is not vaulted or already unlocked.
 * Payment side effects (checkout redirect) happen only in startVaultUnlock().
 *
 * @param {{ id: number, title: string }} t
 * @returns {Promise<boolean>}
 */
export async function checkVaultGate(t) {
  try {
    const d = await api.payment.vaultUnlockOptions(t.id);
    if (!d.isVault || d.alreadyUnlocked) return false;
    _showVaultGate(t, d.unlockOptions || {});
    return true;
  } catch { return false; }
}

function _showVaultGate(t, opts) {
  el('vg-title').textContent = t.title;
  const container = el('vg-options');
  container.innerHTML = '';

  function makeOption(labelText, priceText, subText, onClick) {
    const div = document.createElement('div');
    div.className = 'vg-option';
    div.innerHTML = `
      <div>
        <div class="vg-option-label">${labelText}</div>
        <div class="vg-option-price">${priceText}</div>
        ${subText ? `<div class="vg-option-sub">${subText}</div>` : ''}
      </div>
      <button class="vg-btn">UNLOCK</button>`;
    div.querySelector('.vg-btn').addEventListener('click', onClick);
    container.appendChild(div);
  }

  if (opts.track) {
    const p     = opts.track;
    const price = p.allowFree ? 'FREE' : `$${(p.minimumPrice / 100).toFixed(2)}`;
    const sub   = p.paymentType === 'recurring' ? `per ${p.recurringInterval || 'month'}` : 'one-time';
    makeOption('THIS TRACK', price, sub,
      () => startVaultUnlock('track', t.id, p.minimumPrice, p.paymentType, p.recurringInterval));
  }

  if (opts.project) {
    const p     = opts.project;
    const price = p.allowFree ? 'FREE' : `$${(p.minimumPrice / 100).toFixed(2)}`;
    const sub   = `${esc(p.name)} · ${p.paymentType === 'recurring' ? `per ${p.recurringInterval || 'month'}` : 'one-time'}`;
    makeOption('FULL PROJECT', price, sub,
      () => startVaultUnlock('project', p.id, p.minimumPrice, p.paymentType, p.recurringInterval));
  }

  if (opts.allAccess) {
    const p     = opts.allAccess;
    const price = p.allowFree ? 'FREE' : `$${(p.minimumPrice / 100).toFixed(2)}`;
    const sub   = p.paymentType === 'recurring' ? `per ${p.recurringInterval || 'month'}` : 'one-time';
    makeOption('ALL-ACCESS PASS', price, sub,
      () => startVaultUnlock('all_access', null, p.minimumPrice, p.paymentType, p.recurringInterval));
  }

  // Subscription is always offered as an alternative
  const subDiv = document.createElement('div');
  subDiv.className = 'vg-option';
  subDiv.innerHTML = `
    <div>
      <div class="vg-option-label">SUBSCRIBER</div>
      <div class="vg-option-price">Support the station</div>
      <div class="vg-option-sub">Unlocks all supporters content</div>
    </div>
    <button class="vg-btn secondary">SUBSCRIBE</button>`;
  subDiv.querySelector('.vg-btn').addEventListener('click', async function() {
    this.classList.add('processing'); this.textContent = '…';
    try {
      const data = await api.payment.checkoutUrl();
      if (data.checkoutUrl) { window.location.href = data.checkoutUrl; return; }
    } catch {}
    this.classList.remove('processing'); this.textContent = 'SUBSCRIBE';
  });
  container.appendChild(subDiv);

  if (!authState.loggedIn) {
    const loginHint = document.createElement('div');
    loginHint.className = 'vg-login-hint';
    loginHint.innerHTML = 'Already have an account? <button>Log in</button>';
    loginHint.querySelector('button').addEventListener('click', () => {
      _closeVaultGate();
      _setAuthTab('login');
      state.showShare = true;
      state.sharePanel = 'account';
      _render();
      _toggleAuthSection(true);
      setTimeout(() => el('auth-email').focus(), 120);
    });
    container.appendChild(loginHint);
  }

  el('vault-gate-backdrop').classList.add('open');
}

export async function startVaultUnlock(unlockType, targetId, amount, paymentType, recurringInterval) {
  const body = { unlock_type: unlockType, amount, payment_type: paymentType };
  if (targetId)          body.target_id          = targetId;
  if (recurringInterval) body.recurring_interval  = recurringInterval;
  try {
    const data = await api.payment.vaultUnlock(body);
    if (data.checkoutUrl) window.location.href = data.checkoutUrl;
  } catch {}
}

function _closeVaultGate() {
  el('vault-gate-backdrop').classList.remove('open');
}

// ── Event wiring (called from main.js in Phase 8) ─────────────────────────────

export function initPaymentHandlers() {
  // Modal tab switching
  document.querySelectorAll('.modal-tab').forEach(btn =>
    btn.addEventListener('click', () => setModalTab(btn.dataset.tab)));
  // Tip amount input clears preset selection
  el('tip-amount').addEventListener('input', () => {
    selectedTipCents = null;
    document.querySelectorAll('.tip-preset').forEach(b => b.classList.remove('active'));
    _updateCTA();
  });
  // Modal close paths
  el('modal-close').addEventListener('click', closeModal);
  el('modal-backdrop').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal();
  });
  el('modal-done-close').addEventListener('click', closeModal);
  // CTA (tip send / subscription checkout)
  el('modal-cta').addEventListener('click', _handleCtaClick);
  // Vault gate close paths
  el('vg-close').addEventListener('click', _closeVaultGate);
  el('vault-gate-backdrop').addEventListener('click', e => {
    if (e.target === e.currentTarget) _closeVaultGate();
  });
}

export function initFloatingTip() {
  const tipEl    = el('floating-tip');
  let pos        = { x: 0, y: 0 };
  let target     = { x: 0, y: 0 };
  let paused     = false;
  let tapCount   = 0;
  let pauseTimer = null;
  const isMobile = window.matchMedia('(pointer:coarse)').matches;

  function newTarget() {
    const p = 48;
    target = {
      x: p + Math.random() * (window.innerWidth  - p * 2),
      y: p + Math.random() * (window.innerHeight - p * 2),
    };
  }

  function setPaused(v, ms) {
    paused = v;
    tipEl.classList.toggle('paused', v);
    if (v && ms) {
      clearTimeout(pauseTimer);
      pauseTimer = setTimeout(() => {
        paused = false;
        tipEl.classList.remove('paused');
        tapCount = 0;
      }, ms);
    }
  }

  pos = {
    x: 80 + Math.random() * (window.innerWidth  - 160),
    y: 80 + Math.random() * (window.innerHeight - 160),
  };
  tipEl.style.left = pos.x + 'px';
  tipEl.style.top  = pos.y + 'px';
  newTarget();

  (function loop() {
    if (!paused) {
      const dx = target.x - pos.x, dy = target.y - pos.y;
      if (Math.sqrt(dx * dx + dy * dy) < 30) {
        newTarget();
      } else {
        pos.x += dx * 0.008;
        pos.y += dy * 0.008;
        tipEl.style.left = pos.x + 'px';
        tipEl.style.top  = pos.y + 'px';
      }
    }
    requestAnimationFrame(loop);
  })();

  if (!isMobile) {
    tipEl.addEventListener('mouseenter', () => { clearTimeout(pauseTimer); setPaused(true); });
    tipEl.addEventListener('mouseleave', () => setPaused(false));
    tipEl.addEventListener('click', openModal);
  } else {
    tipEl.addEventListener('touchend', e => {
      e.preventDefault();
      tapCount++;
      if (tapCount === 1) {
        setPaused(true, 4000);
      } else {
        clearTimeout(pauseTimer);
        setPaused(false);
        tapCount = 0;
        openModal();
      }
    });
  }
}
