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
    try {
      // A listener account can exist at any tier (including free), and its
      // owner must always be able to log out, export, or delete it.
      // Welcome-page profiles (display name only) also answer here with
      // hasAccount: false.
      const acc = await api.auth.listenerMe();
      Object.assign(authState, {
        loggedIn: true,
        email: acc.email || '',
        displayName: acc.displayName || '',
        tier: me.tier,
        hasPassword: !!acc.hasPassword,
        hasAccount: acc.hasAccount !== false,
        subscriptionStatus: acc.subscriptionStatus || null,
        provider: acc.provider || null,
      });
    } catch {
      if (me.tier === 'free') {
        Object.assign(authState, { loggedIn: false, email: '', displayName: '', tier: 'free', hasPassword: false, hasAccount: false, subscriptionStatus: null, provider: null });
      } else {
        // Creator-issued token: valid non-free tier but no listener account
        Object.assign(authState, { loggedIn: true, email: '', displayName: '', tier: me.tier, hasPassword: true, hasAccount: false, subscriptionStatus: null, provider: null });
      }
    }
  } catch {
    Object.assign(authState, { loggedIn: false, email: '', displayName: '', tier: 'free', hasPassword: false, hasAccount: false, subscriptionStatus: null, provider: null });
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
    el('auth-email-display').textContent = authState.email || authState.displayName || '—';
    const badge = el('auth-tier-badge');
    badge.textContent = authState.tier.replace('_', ' ').toUpperCase();
    badge.className   = `auth-tier-badge ${authState.tier}`;
    const needsPw = authState.tier !== 'free' && !authState.hasPassword;
    el('auth-set-pw').hidden = !needsPw;
    if (!needsPw) el('auth-setpw-form').hidden = true;

    // Account management. Welcome-page profiles (displayName, no account) can
    // also export and delete their data; billing actions need a real account.
    const hasAccount = !!authState.hasAccount;
    const isProfile  = !hasAccount && !!authState.displayName;
    const activeSub  = authState.subscriptionStatus === 'active';
    el('auth-complete-account-btn').hidden = !isProfile;
    el('auth-export-btn').hidden     = !(hasAccount || isProfile);
    el('auth-delete-btn').hidden     = !(hasAccount || isProfile);
    el('auth-cancel-sub-btn').hidden = !(hasAccount && activeSub);
    el('auth-portal-btn').hidden     = !(hasAccount && activeSub && authState.provider === 'stripe');
  } else {
    status.textContent = '';
    el('auth-complete-account-btn').hidden = true;
  }
}

export function setAuthTab(tab) {
  authTab = tab;
  document.querySelectorAll('.auth-tab').forEach(b =>
    b.classList.toggle('active', b.dataset.authTab === tab));
  el('auth-submit-btn').textContent = tab === 'login' ? 'LOG IN' : 'CREATE ACCOUNT';
  el('auth-msg').textContent = '';
}

export function showAccountCompletion() {
  toggleAuthSection(true);
  el('auth-logged-out').hidden = false;
  el('auth-logged-in').hidden = true;
  document.querySelectorAll('.auth-tab').forEach(b => { b.disabled = false; });
  ['auth-email', 'auth-password'].forEach(id => { el(id).disabled = false; });
  el('auth-submit-btn').disabled = false;
  setAuthTab('register');

  const emailInput = el('auth-email');
  const passwordInput = el('auth-password');
  if (!emailInput.value && authState.email) emailInput.value = authState.email;
  el('auth-msg').className = 'auth-msg';
  el('auth-msg').textContent = 'Create an account to keep purchases and unlocks.';
  setTimeout(() => (emailInput.value ? passwordInput : emailInput).focus(), 120);
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

// ── Forgot password ───────────────────────────────────────────────────────────

async function handleForgotPassword() {
  const email = el('auth-email').value.trim();
  const msg = el('auth-msg');
  msg.className = 'auth-msg';
  if (!email || !email.includes('@')) {
    msg.className = 'auth-msg error';
    msg.textContent = 'Enter your email above first, then click forgot password.';
    return;
  }
  try {
    const { data } = await api.auth.requestPasswordReset(email);
    msg.className = 'auth-msg success';
    msg.textContent = data.emailEnabled
      ? 'If an account exists for that email, a reset link is on its way.'
      : 'This station has no email set up — ask the creator to generate a reset link for you.';
  } catch {
    msg.className = 'auth-msg error';
    msg.textContent = 'Network error — please try again.';
  }
}

// ── Password reset completion (#reset=<token> links) ─────────────────────────

/**
 * If the URL carries a reset token (from an emailed or creator-generated
 * link), show a standalone overlay to choose a new password. Independent of
 * drawer state so the link works no matter where it is opened.
 */
export function maybeShowResetForm() {
  const match = window.location.hash.match(/^#reset=([A-Za-z0-9]+)$/);
  if (!match) return;
  const token = match[1];

  const wrap = document.createElement('div');
  wrap.id = 'reset-overlay';
  wrap.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.88);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
  wrap.innerHTML = `
    <div style="width:100%;max-width:340px;background:#0d0d0d;border:1px solid rgba(255,255,255,.14);border-radius:10px;padding:22px;">
      <div style="font-family:'Space Mono',monospace;font-size:11px;letter-spacing:.14em;color:rgba(255,255,255,.6);margin-bottom:14px;">CHOOSE A NEW PASSWORD</div>
      <input class="auth-input" id="reset-password-input" type="password" placeholder="new password (min 8 chars)" autocomplete="new-password" style="width:100%;margin-bottom:10px;"/>
      <button class="auth-submit" id="reset-submit-btn" style="width:100%;">SET NEW PASSWORD</button>
      <div class="auth-msg" id="reset-msg" style="margin-top:8px;"></div>
      <button id="reset-cancel-btn" style="background:none;border:none;color:rgba(255,255,255,.3);font-family:'Space Mono',monospace;font-size:10px;cursor:pointer;margin-top:10px;padding:0;">CANCEL</button>
    </div>`;
  document.body.appendChild(wrap);

  function closeOverlay() {
    wrap.remove();
    if (window.location.hash.startsWith('#reset=')) {
      history.replaceState(null, '', window.location.pathname);
    }
  }

  wrap.querySelector('#reset-cancel-btn').addEventListener('click', closeOverlay);
  const submit = wrap.querySelector('#reset-submit-btn');
  const input = wrap.querySelector('#reset-password-input');
  const msg = wrap.querySelector('#reset-msg');

  async function submitReset() {
    const password = input.value;
    msg.className = 'auth-msg';
    if (!password || password.length < 8) {
      msg.className = 'auth-msg error';
      msg.textContent = 'Password must be at least 8 characters.';
      return;
    }
    submit.disabled = true;
    submit.textContent = '…';
    try {
      const { res, data } = await api.auth.resetPassword(token, password);
      if (!res.ok) {
        msg.className = 'auth-msg error';
        msg.textContent = data.error || 'Reset failed.';
      } else {
        msg.className = 'auth-msg success';
        msg.textContent = 'Password updated — you can now log in.';
        setTimeout(() => {
          closeOverlay();
          toggleAuthSection(true);
          setAuthTab('login');
        }, 1400);
        return;
      }
    } catch {
      msg.className = 'auth-msg error';
      msg.textContent = 'Network error — please try again.';
    }
    submit.disabled = false;
    submit.textContent = 'SET NEW PASSWORD';
  }

  submit.addEventListener('click', submitReset);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') submitReset(); });
  setTimeout(() => input.focus(), 80);
}

// ── Account management (cancel / billing portal / export / delete) ───────────

async function handleCancelSubscription() {
  const msg = el('auth-manage-msg');
  msg.className = 'auth-msg';
  if (!confirm('Cancel your subscription? You keep access until the end of the paid period.')) return;
  try {
    const { res, data } = await api.payment.cancelSubscription();
    if (!res.ok) {
      msg.className = 'auth-msg error';
      msg.textContent = data.error || 'Cancellation failed.';
      return;
    }
    msg.className = 'auth-msg success';
    msg.textContent = data.effectiveUntil
      ? `Cancelled — access continues until ${new Date(data.effectiveUntil).toLocaleDateString()}.`
      : 'Cancellation requested — your provider will process it shortly.';
    el('auth-cancel-sub-btn').hidden = true;
  } catch {
    msg.className = 'auth-msg error';
    msg.textContent = 'Network error — please try again.';
  }
}

async function handleBillingPortal() {
  const msg = el('auth-manage-msg');
  msg.className = 'auth-msg';
  try {
    const { res, data } = await api.payment.billingPortal();
    if (!res.ok || !data.url) {
      msg.className = 'auth-msg error';
      msg.textContent = data.error || 'Could not open the billing portal.';
      return;
    }
    window.open(data.url, '_blank');
  } catch {
    msg.className = 'auth-msg error';
    msg.textContent = 'Network error — please try again.';
  }
}

async function handleDeleteAccount() {
  const msg = el('auth-manage-msg');
  msg.className = 'auth-msg';

  // Welcome-page profile without a full account: no password to confirm.
  if (!authState.hasAccount && authState.displayName) {
    if (!confirm('Delete your listener profile? This removes your display name and any saved email. This cannot be undone.')) return;
    try {
      const { res, data } = await api.auth.deleteProfile();
      if (!res.ok) {
        msg.className = 'auth-msg error';
        msg.textContent = data.error || 'Deletion failed.';
        return;
      }
      msg.className = 'auth-msg success';
      msg.textContent = 'Profile deleted.';
      Object.assign(authState, { loggedIn: false, email: '', displayName: '', tier: 'free', hasPassword: false, hasAccount: false, subscriptionStatus: null, provider: null });
      setTimeout(() => { renderAuthSection(); _loadLibrary(); }, 1200);
    } catch {
      msg.className = 'auth-msg error';
      msg.textContent = 'Network error — please try again.';
    }
    return;
  }

  if (!confirm('Permanently delete your account? Unlocked content and subscriptions will be lost. This cannot be undone.')) return;

  const body = {};
  if (authState.hasPassword) {
    const password = prompt('Enter your password to confirm deletion:');
    if (!password) return;
    body.password = password;
  } else {
    const confirmEmail = prompt('Type your account email to confirm deletion:');
    if (!confirmEmail) return;
    body.confirmEmail = confirmEmail;
  }

  try {
    const { res, data } = await api.auth.deleteAccount(body);
    if (!res.ok) {
      msg.className = 'auth-msg error';
      msg.textContent = data.error || 'Deletion failed.';
      return;
    }
    msg.className = 'auth-msg success';
    msg.textContent = (data.warnings || []).join(' ') || 'Account deleted.';
    Object.assign(authState, { loggedIn: false, email: '', tier: 'free', hasPassword: false, hasAccount: false, subscriptionStatus: null, provider: null });
    setTimeout(() => { renderAuthSection(); _loadLibrary(); }, 1200);
  } catch {
    msg.className = 'auth-msg error';
    msg.textContent = 'Network error — please try again.';
  }
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
  el('auth-complete-account-btn').addEventListener('click', showAccountCompletion);
  el('auth-set-pw').addEventListener('click', () => {
    el('auth-setpw-form').hidden = false;
    el('auth-new-password').focus();
  });
  el('auth-setpw-btn').addEventListener('click', handleSetPassword);
  el('auth-forgot-btn').addEventListener('click', handleForgotPassword);
  el('auth-cancel-sub-btn').addEventListener('click', handleCancelSubscription);
  el('auth-portal-btn').addEventListener('click', handleBillingPortal);
  el('auth-export-btn').addEventListener('click', () => { window.location.href = '/api/listener/export'; });
  el('auth-delete-btn').addEventListener('click', handleDeleteAccount);

  maybeShowResetForm();
}
