/**
 * dashboard/index.js — Dashboard auth gate, orchestrator, and account typeahead.
 */

import * as api from '../api.js';
import { el, esc } from '../utils.js';

// ── Module-local state ─────────────────────────────────────────────────────────
let dashboardInitialized = false;
let pendingChallenge = null;
export let DASH_ACCOUNTS = [];

// ── Injected callbacks ─────────────────────────────────────────────────────────
let _loadDashStation        = () => {};
let _loadDashVaultStats     = () => {};
let _loadDashBroadcast      = () => {};
let _loadDashLive           = () => {};
let _loadRadioHostStatus    = () => {};
let _loadDashSchedule       = () => {};
let _loadDashProjects       = () => {};
let _loadDashLibrary        = () => {};
let _loadDashAnalytics      = () => {};
let _loadDash2FA            = () => {};
let _loadDashPaymentConfig  = () => {};
let _loadDashTipConfig      = () => {};
let _loadDashBio            = () => {};
let _loadPlayCounts         = () => {};
let _bindVaultStatButtons   = () => {};
let _initExtSearchPanel     = () => {};
let _loadCreatorType        = () => {};
let _initUploadHandlers     = () => {};
let _loadDashTokens         = () => {};
let _loadDashShareLinks     = () => {};
let _loadDashAllAccess      = () => {};

export function init(callbacks = {}) {
  if (callbacks.loadDashStation)       _loadDashStation       = callbacks.loadDashStation;
  if (callbacks.loadDashVaultStats)    _loadDashVaultStats    = callbacks.loadDashVaultStats;
  if (callbacks.loadDashBroadcast)     _loadDashBroadcast     = callbacks.loadDashBroadcast;
  if (callbacks.loadDashLive)          _loadDashLive          = callbacks.loadDashLive;
  if (callbacks.loadRadioHostStatus)   _loadRadioHostStatus   = callbacks.loadRadioHostStatus;
  if (callbacks.loadDashSchedule)      _loadDashSchedule      = callbacks.loadDashSchedule;
  if (callbacks.loadDashProjects)      _loadDashProjects      = callbacks.loadDashProjects;
  if (callbacks.loadDashLibrary)       _loadDashLibrary       = callbacks.loadDashLibrary;
  if (callbacks.loadDashAnalytics)     _loadDashAnalytics     = callbacks.loadDashAnalytics;
  if (callbacks.loadDash2FA)           _loadDash2FA           = callbacks.loadDash2FA;
  if (callbacks.loadDashPaymentConfig) _loadDashPaymentConfig = callbacks.loadDashPaymentConfig;
  if (callbacks.loadDashTipConfig)     _loadDashTipConfig     = callbacks.loadDashTipConfig;
  if (callbacks.loadDashBio)           _loadDashBio           = callbacks.loadDashBio;
  if (callbacks.loadPlayCounts)        _loadPlayCounts        = callbacks.loadPlayCounts;
  if (callbacks.bindVaultStatButtons)  _bindVaultStatButtons  = callbacks.bindVaultStatButtons;
  if (callbacks.initExtSearchPanel)    _initExtSearchPanel    = callbacks.initExtSearchPanel;
  if (callbacks.loadCreatorType)       _loadCreatorType       = callbacks.loadCreatorType;
  if (callbacks.initUploadHandlers)    _initUploadHandlers    = callbacks.initUploadHandlers;
  if (callbacks.loadDashTokens)        _loadDashTokens        = callbacks.loadDashTokens;
  if (callbacks.loadDashShareLinks)    _loadDashShareLinks    = callbacks.loadDashShareLinks;
  if (callbacks.loadDashAllAccess)     _loadDashAllAccess     = callbacks.loadDashAllAccess;
}

// ── Auth probe ─────────────────────────────────────────────────────────────────
export async function tryDashAuth() {
  return api.dashboard.check();
}

// ── Gate visibility ────────────────────────────────────────────────────────────
export function setDashGate(gate) {
  el('dash-auth-gate').hidden = gate !== 'auth';
  el('dash-2fa-gate').hidden  = gate !== '2fa';
  el('dash-content').hidden   = gate !== 'content';
}

function showDashAuthGate() {
  setDashGate('auth');
}

let dashboardLoaded = false;

function showDashContent() {
  const input = el('dash-token-input');
  const btn   = el('dash-token-btn');
  input.disabled      = true;
  input.style.opacity = '.3';
  // stationName comes from window global set during init
  const stationName = window._stationName || '';
  btn.textContent   = stationName ? `Welcome back, ${stationName}` : 'Welcome back';
  btn.style.cursor  = 'default';
  btn.style.background  = 'rgba(57,255,20,.07)';
  btn.style.borderColor = 'rgba(57,255,20,.25)';
  btn.style.color       = '#39ff14';
  el('dash-auth-msg').textContent = '';
  setDashGate('content');
  document.body.classList.add('creator-mode');
  if (!dashboardLoaded) { dashboardLoaded = true; loadDashboard(); }
  checkLaunchAcceptance();
}

export async function initDashboard() {
  if (dashboardInitialized) return;
  dashboardInitialized = true;
  if (await tryDashAuth()) { showDashContent(); return; }
  showDashAuthGate();
}

// ── Typeahead ──────────────────────────────────────────────────────────────────
export function makeTypeahead(inputEl, dropEl, accounts) {
  let focusedIdx = -1;

  function items() { return [...dropEl.querySelectorAll('.typeahead-item')]; }

  function render(filtered) {
    focusedIdx = -1;
    if (!filtered.length) { dropEl.hidden = true; return; }
    dropEl.innerHTML = filtered.slice(0, 10).map(a =>
      `<div class="typeahead-item" data-email="${esc(a.email)}">${esc(a.email)}</div>`
    ).join('');
    dropEl.hidden = false;
    dropEl.querySelectorAll('.typeahead-item').forEach(item => {
      item.addEventListener('mousedown', e => {
        e.preventDefault();
        inputEl.value = item.dataset.email;
        dropEl.hidden = true;
        focusedIdx = -1;
      });
    });
  }

  function filter() {
    const q = inputEl.value.toLowerCase().trim();
    if (!q) { dropEl.hidden = true; return; }
    render(accounts.filter(a => a.email.toLowerCase().includes(q)));
  }

  inputEl.addEventListener('input', filter);
  inputEl.addEventListener('focus', () => {
    if (inputEl.value.trim()) filter();
    else if (accounts.length && accounts.length <= 30) render(accounts);
  });
  inputEl.addEventListener('blur', () => { setTimeout(() => { dropEl.hidden = true; }, 160); });
  inputEl.addEventListener('keydown', e => {
    const list = items();
    if (e.key === 'Escape') { dropEl.hidden = true; return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (list[focusedIdx]) list[focusedIdx].classList.remove('focused');
      focusedIdx = Math.min(focusedIdx + 1, list.length - 1);
      if (list[focusedIdx]) { list[focusedIdx].classList.add('focused'); list[focusedIdx].scrollIntoView({ block:'nearest' }); }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (list[focusedIdx]) list[focusedIdx].classList.remove('focused');
      focusedIdx = Math.max(focusedIdx - 1, 0);
      if (list[focusedIdx]) { list[focusedIdx].classList.add('focused'); list[focusedIdx].scrollIntoView({ block:'nearest' }); }
    } else if (e.key === 'Enter' && focusedIdx >= 0 && list[focusedIdx]) {
      e.preventDefault();
      inputEl.value = list[focusedIdx].dataset.email;
      dropEl.hidden = true;
      focusedIdx = -1;
    }
  });
}

// ── Account loading ────────────────────────────────────────────────────────────
export async function loadDashAccounts() {
  try {
    DASH_ACCOUNTS = await api.dashboard.accounts();
    makeTypeahead(el('new-token-email'), el('new-token-email-drop'), DASH_ACCOUNTS);
  } catch {}
}

// ── Runtime alert ──────────────────────────────────────────────────────────────
export async function loadDashRuntime() {
  const alert = el('dash-runtime-alert');
  try {
    const data = await api.dashboard.runtime();
    if (data.ffmpeg && data.ffmpeg.ok === false) {
      alert.textContent = data.ffmpeg.message || 'FFmpeg is not available. Broadcasts and previews cannot be generated.';
      alert.hidden = false;
    } else {
      alert.hidden = true;
      alert.textContent = '';
    }
  } catch {
    alert.hidden = true;
  }
}

// ── Payment config ─────────────────────────────────────────────────────────────
export async function loadDashPaymentConfig() {
  try {
    const d = await api.dashboard.paymentConfig();

    const check = ok => ok
      ? '<span style="color:#39ff14;">✓</span>'
      : '<span style="color:#ff4466;">✗</span>';

    const stripeNotice = !d.stripe.connected ? `
      <div style="margin-top:10px;padding:10px 12px;background:rgba(255,255,255,.03);border:1px dashed rgba(255,255,255,.1);border-radius:8px;font-family:'Space Mono',monospace;font-size:10px;color:rgba(255,255,255,.3);line-height:1.9;letter-spacing:.03em;">
        Add to <strong style="color:rgba(255,255,255,.5);">.env</strong> to enable payments:<br>
        STRIPE_SECRET_KEY=sk_live_…<br>
        STRIPE_WEBHOOK_SECRET=whsec_…<br>
        STRIPE_PRICE_SUBSCRIBER=price_…<br>
        STRIPE_PRICE_PRO=price_…<br>
        STRIPE_PRICE_ALL_ACCESS=price_…
      </div>` : '';

    el('dash-payment-status').innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:0 16px;">
        <div class="stat-card" style="text-align:left;">
          <div class="stat-key" style="margin-bottom:8px;">STRIPE</div>
          <div style="font-family:'Space Mono',monospace;font-size:11px;color:rgba(255,255,255,.45);line-height:2;">
            Secret key ${check(d.stripe.connected)}<br>
            Webhook ${check(d.stripe.webhookConfigured)}<br>
            Subscriber price ${check(d.stripe.prices.subscriber)}<br>
            Pro price ${check(d.stripe.prices.pro)}<br>
            All-Access price ${check(d.stripe.prices.allAccess)}
          </div>
        </div>
        <div class="stat-card" style="text-align:left;">
          <div class="stat-key" style="margin-bottom:8px;">PAYPAL</div>
          <div style="font-family:'Space Mono',monospace;font-size:11px;color:rgba(255,255,255,.45);line-height:2;">
            Credentials ${check(d.paypal.connected)}<br>
            Pro plan ${check(d.paypal.plans.pro)}<br>
            All-Access plan ${check(d.paypal.plans.allAccess)}
          </div>
        </div>
      </div>
      ${stripeNotice}`;
  } catch {}
}

// ── Launch acceptance ──────────────────────────────────────────────────────────
export async function checkLaunchAcceptance() {
  try {
    const d = await api.dashboard.system.launchStatus();
    if (!d.accepted) {
      el('launch-backdrop').hidden = false;
    }
  } catch {}
}

// ── Dashboard orchestrator ─────────────────────────────────────────────────────
export function loadDashboard() {
  _bindVaultStatButtons();
  _loadCreatorType();
  loadDashRuntime();
  _loadDashStation();
  _loadDashVaultStats();
  _loadDashBroadcast();
  _loadDashLive();
  _loadRadioHostStatus();
  _loadDashSchedule();
  _loadDashProjects();
  _loadDashLibrary();
  loadDashAccounts();
  _loadDashTokens();
  _loadDashShareLinks();
  _loadDashAllAccess();
  _loadDashAnalytics();
  _loadDash2FA();
  loadDashPaymentConfig();
  _loadDashTipConfig();
  _loadDashBio();
  _loadPlayCounts();
}

// ── Gate event handlers ────────────────────────────────────────────────────────
export function initDashGateHandlers() {
  el('dash-token-btn').addEventListener('click', async () => {
    const token = el('dash-token-input').value.trim();
    if (!token) return;
    pendingChallenge = null;
    el('dash-auth-msg').textContent = '';
    el('dash-token-btn').textContent = 'CHECKING…';
    el('dash-token-btn').disabled = true;

    try {
      const { res, data } = await api.auth.dashboardLogin(token);

      if (!res.ok) {
        pendingChallenge = null;
        el('dash-auth-msg').className   = 'dash-error-msg';
        el('dash-auth-msg').textContent = data.error || 'Invalid token';
        return;
      }

      if (data.requires2FA) {
        pendingChallenge = data.challenge;
        setDashGate('2fa');
        el('dash-2fa-input').value     = '';
        el('dash-2fa-msg').textContent = '';
        setTimeout(() => el('dash-2fa-input').focus(), 80);
      } else {
        pendingChallenge = null;
        showDashContent();
      }
    } catch {
      pendingChallenge = null;
      el('dash-2fa-input').value      = '';
      el('dash-auth-msg').className   = 'dash-error-msg';
      el('dash-auth-msg').textContent = 'Connection error';
    } finally {
      el('dash-token-btn').textContent = 'UNLOCK';
      el('dash-token-btn').disabled    = false;
    }
  });

  el('dash-token-input').addEventListener('keydown', e => { if (e.key === 'Enter') el('dash-token-btn').click(); });

  el('dash-2fa-btn').addEventListener('click', async () => {
    const code = el('dash-2fa-input').value.trim().replace(/\s/g, '');
    if (!code) return;
    if (!pendingChallenge) {
      el('dash-2fa-msg').className   = 'dash-error-msg';
      el('dash-2fa-msg').textContent = 'Start login again';
      el('dash-2fa-input').value     = '';
      return;
    }
    el('dash-2fa-msg').textContent  = '';
    el('dash-2fa-btn').textContent  = 'VERIFYING…';
    el('dash-2fa-btn').disabled     = true;

    try {
      const { res, data } = await api.auth.dashboardVerify2fa(pendingChallenge, code);

      if (!res.ok) {
        pendingChallenge = null;
        el('dash-2fa-msg').className   = 'dash-error-msg';
        el('dash-2fa-msg').textContent = data.error || 'Invalid code';
        el('dash-2fa-input').value     = '';
        el('dash-2fa-input').focus();
        return;
      }

      pendingChallenge = null;
      showDashContent();
    } catch {
      pendingChallenge = null;
      el('dash-2fa-input').value      = '';
      el('dash-2fa-msg').className    = 'dash-error-msg';
      el('dash-2fa-msg').textContent  = 'Connection error';
    } finally {
      el('dash-2fa-btn').textContent = 'VERIFY';
      el('dash-2fa-btn').disabled    = false;
    }
  });

  el('dash-2fa-input').addEventListener('keydown', e => { if (e.key === 'Enter') el('dash-2fa-btn').click(); });

  el('dash-2fa-back').addEventListener('click', () => {
    pendingChallenge = null;
    setDashGate('auth');
    el('dash-2fa-input').value      = '';
    el('dash-auth-msg').textContent = '';
  });

  // Launch acceptance handlers
  function updateLaunchContinue() {
    el('launch-continue').disabled = !(el('launch-chk-license').checked && el('launch-chk-content').checked);
  }
  el('launch-chk-license').addEventListener('change', updateLaunchContinue);
  el('launch-chk-content').addEventListener('change', updateLaunchContinue);
  el('launch-continue').addEventListener('click', async () => {
    try {
      await api.dashboard.system.launchAccept();
    } catch {}
    el('launch-backdrop').hidden = true;
  });
}
