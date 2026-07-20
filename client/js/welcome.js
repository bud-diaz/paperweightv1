/**
 * welcome.js — First-visit welcome overlay (Papercut-style onboarding).
 *
 * Shown once to visitors with no listener identity. Entering the station
 * creates a full listener account (display name + email + password) — email
 * is what unlocks the higher free on-demand play allowance, and explicit
 * marketing consent feeds the creator's audience list. "Just listen"
 * dismisses without creating anything so the public stream stays
 * frictionless (at the anonymous play limit).
 *
 * Callbacks injected via init() (callback-injection pattern, see main.js):
 *   onEntered — reload auth state + library after the account is created
 *   openLogin — jump to the account panel's login form (optionally prefilled)
 */

import { authState } from './state.js';
import { el } from './utils.js';
import * as api from './api.js';

const DISMISS_KEY = 'pw_welcome_done';

let _onEntered = () => {};
let _openLogin = () => {};

export function init({ onEntered, openLogin } = {}) {
  if (onEntered) _onEntered = onEntered;
  if (openLogin) _openLogin = openLogin;
}

function dismissed() {
  try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
}

function markDismissed() {
  try { localStorage.setItem(DISMISS_KEY, '1'); } catch {}
}

/**
 * Show the overlay when the visitor has no identity yet (no account, no
 * profile, no creator token) and hasn't dismissed it before. Call after
 * loadAuthState() so authState reflects the cookie.
 */
export function maybeShowWelcome(stationName) {
  if (dismissed()) return;
  if (authState.loggedIn) { markDismissed(); return; }
  showWelcome(stationName);
}

export function showWelcome(stationName) {
  const wrap = document.createElement('div');
  wrap.id = 'welcome-overlay';
  wrap.innerHTML = `
    <div id="welcome-card">
      <div class="welcome-kicker">WELCOME TO</div>
      <div class="welcome-station">${stationName ? escapeHtml(stationName) : 'Paperweight'}</div>
      <div class="welcome-sub">Independent broadcasting, direct from the creator.</div>

      <div class="welcome-label">CHOOSE A DISPLAY NAME</div>
      <input class="auth-input" id="welcome-name" type="text" maxlength="50" placeholder="e.g. Alex" autocomplete="nickname"/>

      <div class="welcome-label">YOUR EMAIL</div>
      <input class="auth-input" id="welcome-email" type="email" placeholder="you@example.com" autocomplete="email"/>

      <div class="welcome-label">CHOOSE A PASSWORD</div>
      <input class="auth-input" id="welcome-password" type="password" minlength="8" placeholder="8+ characters" autocomplete="new-password"/>

      <label class="welcome-consent">
        <input type="checkbox" id="welcome-optin"/>
        <span>Send me updates and releases from this station</span>
      </label>

      <button class="auth-submit" id="welcome-enter" disabled>ENTER STATION →</button>
      <div class="auth-msg" id="welcome-msg"></div>

      <div class="welcome-foot">
        <button id="welcome-login" type="button">ALREADY HAVE AN ACCOUNT? LOG IN</button>
        <button id="welcome-skip" type="button">JUST LISTEN →</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);

  const nameInput  = wrap.querySelector('#welcome-name');
  const emailInput = wrap.querySelector('#welcome-email');
  const passInput  = wrap.querySelector('#welcome-password');
  const loginBtn   = wrap.querySelector('#welcome-login');
  const enterBtn   = wrap.querySelector('#welcome-enter');
  const msg        = wrap.querySelector('#welcome-msg');

  // Set after a 409 so LOG IN opens with the already-registered email filled in.
  let _prefillEmail = '';

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  function formValid() {
    return !!nameInput.value.trim()
      && EMAIL_RE.test(emailInput.value.trim())
      && passInput.value.length >= 8;
  }
  for (const input of [nameInput, emailInput, passInput]) {
    input.addEventListener('input', () => { enterBtn.disabled = !formValid(); });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') enter(); });
  }

  async function enter() {
    if (!formValid()) return;
    const displayName = nameInput.value.trim();
    const email = emailInput.value.trim();
    const optIn = wrap.querySelector('#welcome-optin').checked;

    enterBtn.disabled = true;
    enterBtn.textContent = '…';
    msg.className = 'auth-msg';
    msg.textContent = '';
    try {
      const { res, data } = await api.auth.register(email, passInput.value, {
        displayName,
        marketingOptIn: optIn,
      });
      if (!res.ok) {
        msg.className = 'auth-msg error';
        if (res.status === 409) {
          msg.textContent = 'An account with this email already exists — use LOG IN below.';
          loginBtn.classList.add('welcome-login-hint');
          _prefillEmail = email;
        } else {
          msg.textContent = data.error || 'Something went wrong.';
        }
        enterBtn.disabled = false;
        enterBtn.textContent = 'ENTER STATION →';
        return;
      }
      markDismissed();
      wrap.remove();
      _onEntered();
    } catch {
      msg.className = 'auth-msg error';
      msg.textContent = 'Network error — please try again.';
      enterBtn.disabled = false;
      enterBtn.textContent = 'ENTER STATION →';
    }
  }

  enterBtn.addEventListener('click', enter);

  wrap.querySelector('#welcome-skip').addEventListener('click', () => {
    markDismissed();
    wrap.remove();
  });

  loginBtn.addEventListener('click', () => {
    markDismissed();
    wrap.remove();
    _openLogin(_prefillEmail);
  });

  setTimeout(() => nameInput.focus(), 120);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
