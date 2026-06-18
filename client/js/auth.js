/**
 * auth.js — Listener authentication: login, register, logout, set password.
 *
 * Owns local state: authTab, authOpen.
 * Mutates authState (from state.js) via Object.assign — never whole-object replace.
 *
 * Calls loadLibrary() via injected callback to avoid importing library.js
 * (cross-import between Phase 5 modules is forbidden).
 *
 * Event wiring (initAuthHandlers) is deferred to Phase 8 main.js.
 */

import { authState } from './state.js';
import { el } from './utils.js';
import * as api from './api.js';

// ── Module-local state ────────────────────────────────────────────────────────

let authTab  = 'login';
let authOpen = false;

// ── Injected callbacks ────────────────────────────────────────────────────────

let _loadLibrary = () => {};

/**
 * Register the loadLibrary callback from library.js.
 * Called from main.js in Phase 8.
 *
 * @param {{ loadLibrary: () => void }} cbs
 */
export function init({ loadLibrary } = {}) {
  if (loadLibrary) _loadLibrary = loadLibrary;
}

// ── Auth state ────────────────────────────────────────────────────────────────

export async function loadAuthState() {
  try {
    const me = await api.auth.me();
    if (me.tier === 'free') {
      Object.assign(authState, { loggedIn: false, email: '', tier: 'free', hasPassword: false });
    } else {
      try {
        const acc = await api.auth.listenerMe();
        Object.assign(authState, { loggedIn: true, email: acc.email || '', tier: me.tier, hasPassword: !!acc.hasPassword });
      } catch {
        // Creator-issued token: valid non-free tier but no listener account
        Object.assign(authState, { loggedIn: true, email: '', tier: me.tier, hasPassword: true });
      }
    }
  } catch {
    Object.assign(authState, { loggedIn: false, email: '', tier: 'free', hasPassword: false });
  }
  renderAuthSection();
}

// ── UI ────────────────────────────────────────────────────────────────────────

export function toggleAuthSection(force) {
  authOpen = force !== undefined ? force : !authOpen;
  el('auth-toggle').classList.toggle('open', authOpen);
  el('auth-body').classList.toggle('open', authOpen);
}

export function renderAuthSection() {
  const loggedIn = authState.loggedIn;
  el('auth-logged-out').hidden = loggedIn;
  el('auth-logged-in').hidden  = !loggedIn;

  el('auth-badge').classList.toggle('visible', loggedIn);

  document.querySelectorAll('.auth-tab').forEach(b => { b.disabled = loggedIn; });
  el('auth-submit-btn').disabled = loggedIn;
  ['auth-email', 'auth-password'].forEach(id => { el(id).disabled = loggedIn; });

  const status = el('auth-toggle-status');
  if (loggedIn) {
    status.textContent = authState.tier.replace('_', ' ').toUpperCase();
    el('auth-email-display').textContent = authState.email || '—';
    const badge = el('auth-tier-badge');
    badge.textContent = authState.tier.replace('_', ' ').toUpperCase();
    badge.className   = `auth-tier-badge ${authState.tier}`;
    const needsPw = authState.tier !== 'free' && !authState.hasPassword;
    el('auth-set-pw').hidden = !needsPw;
    if (!needsPw) el('auth-setpw-form').hidden = true;
  } else {
    status.textContent = '';
  }
}

export function setAuthTab(tab) {
  authTab = tab;
  document.querySelectorAll('.auth-tab').forEach(b =>
    b.classList.toggle('active', b.dataset.authTab === tab));
  el('auth-submit-btn').textContent = tab === 'login' ? 'LOG IN' : 'CREATE ACCOUNT';
  el('auth-msg').textContent = '';
}

export async function submitAuth() {
  const email = el('auth-email').value.trim();
  const password = el('auth-password').value;
  const btn = el('auth-submit-btn');
  const msg = el('auth-msg');

  msg.className = 'auth-msg';
  if (!email || !password) {
    msg.className = 'auth-msg error';
    msg.textContent = 'Email and password are required.';
    return;
  }

  btn.disabled = true;
  btn.textContent = '…';
  msg.textContent = '';

  try {
    const { res, data } = authTab === 'login'
      ? await api.auth.login(email, password)
      : await api.auth.register(email, password);

    if (!res.ok) {
      msg.className = 'auth-msg error';
      msg.textContent = data.error || 'Something went wrong.';
    } else {
      msg.className = 'auth-msg success';
      msg.textContent = authTab === 'login' ? 'Logged in!' : 'Account created!';
      el('auth-email').value    = '';
      el('auth-password').value = '';
      btn.disabled = false;
      btn.textContent = authTab === 'login' ? 'LOG IN' : 'CREATE ACCOUNT';
      await new Promise(r => setTimeout(r, 900));
      await loadAuthState();
      _loadLibrary();
      return;
    }
  } catch {
    msg.className = 'auth-msg error';
    msg.textContent = 'Network error — please try again.';
  }
  btn.disabled = false;
  btn.textContent = authTab === 'login' ? 'LOG IN' : 'CREATE ACCOUNT';
}

export async function logoutListener() {
  try { await api.auth.logout(); } catch {}
  Object.assign(authState, { loggedIn: false, email: '', tier: 'free', hasPassword: false });
  renderAuthSection();
  _loadLibrary();
}

export async function handleSetPassword() {
  const pw  = el('auth-new-password').value;
  const btn = el('auth-setpw-btn');
  const msg = el('auth-setpw-msg');
  msg.className = 'auth-msg';

  if (!pw || pw.length < 8) {
    msg.className = 'auth-msg error';
    msg.textContent = 'Password must be at least 8 characters.';
    return;
  }

  btn.disabled = true; btn.textContent = '…'; msg.textContent = '';
  try {
    const { res, data } = await api.auth.setPassword(pw);
    if (!res.ok) {
      msg.className = 'auth-msg error';
      msg.textContent = data.error || 'Failed to set password.';
    } else {
      authState.hasPassword = true;
      el('auth-set-pw').hidden = true;
      el('auth-new-password').value = '';
      msg.className = 'auth-msg success';
      msg.textContent = 'Password set — you can now log in from any device.';
      setTimeout(() => { el('auth-setpw-form').hidden = true; msg.textContent = ''; }, 3500);
    }
  } catch {
    msg.className = 'auth-msg error';
    msg.textContent = 'Network error — please try again.';
  }
  btn.disabled = false; btn.textContent = 'SET PASSWORD';
}

// ── Event wiring (called from main.js in Phase 8) ─────────────────────────────

export function initAuthHandlers() {
  el('auth-toggle').addEventListener('click', () => toggleAuthSection());
  document.querySelectorAll('.auth-tab').forEach(b =>
    b.addEventListener('click', () => setAuthTab(b.dataset.authTab)));
  el('auth-submit-btn').addEventListener('click', submitAuth);
  el('auth-email').addEventListener('keydown',    e => { if (e.key === 'Enter') el('auth-password').focus(); });
  el('auth-password').addEventListener('keydown', e => { if (e.key === 'Enter') submitAuth(); });
  el('auth-logout-btn').addEventListener('click', logoutListener);
  el('auth-set-pw').addEventListener('click', () => {
    el('auth-setpw-form').hidden = false;
    el('auth-new-password').focus();
  });
  el('auth-setpw-btn').addEventListener('click', handleSetPassword);
}
