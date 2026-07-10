/**
 * welcome.js — First-visit welcome overlay (Papercut-style onboarding).
 *
 * Shown once to visitors with no listener identity: a display name is the only
 * required field. A collapsed optional email section (explicit marketing
 * consent) feeds the creator's audience list. "Just listen" dismisses without
 * creating anything so the public stream stays frictionless.
 *
 * Callbacks injected via init() (callback-injection pattern, see main.js):
 *   onEntered — reload auth state + library after a profile is created
 *   openLogin — jump to the account panel's login form
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

      <button id="welcome-email-toggle" type="button">
        <span id="welcome-email-chev">›</span> ADD YOUR EMAIL <span class="welcome-optional">(OPTIONAL)</span>
      </button>
      <div id="welcome-email-body" hidden>
        <input class="auth-input" id="welcome-email" type="email" placeholder="you@example.com" autocomplete="email"/>
        <label class="welcome-consent">
          <input type="checkbox" id="welcome-optin"/>
          <span>Send me updates and releases from this station</span>
        </label>
      </div>

      <button class="auth-submit" id="welcome-enter" disabled>ENTER STATION →</button>
      <div class="auth-msg" id="welcome-msg"></div>

      <div class="welcome-foot">
        <button id="welcome-login" type="button">ALREADY HAVE AN ACCOUNT? LOG IN</button>
        <button id="welcome-skip" type="button">JUST LISTEN →</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);

  const nameInput  = wrap.querySelector('#welcome-name');
  const enterBtn   = wrap.querySelector('#welcome-enter');
  const msg        = wrap.querySelector('#welcome-msg');
  const emailBody  = wrap.querySelector('#welcome-email-body');
  const emailChev  = wrap.querySelector('#welcome-email-chev');

  nameInput.addEventListener('input', () => {
    enterBtn.disabled = !nameInput.value.trim();
  });

  wrap.querySelector('#welcome-email-toggle').addEventListener('click', () => {
    emailBody.hidden = !emailBody.hidden;
    emailChev.style.transform = emailBody.hidden ? '' : 'rotate(90deg)';
    if (!emailBody.hidden) wrap.querySelector('#welcome-email').focus();
  });

  async function enter() {
    const displayName = nameInput.value.trim();
    if (!displayName) return;
    const email = wrap.querySelector('#welcome-email').value.trim();
    const optIn = wrap.querySelector('#welcome-optin').checked;

    enterBtn.disabled = true;
    enterBtn.textContent = '…';
    msg.className = 'auth-msg';
    msg.textContent = '';
    try {
      const { res, data } = await api.auth.start(displayName, email || undefined, optIn);
      if (!res.ok) {
        msg.className = 'auth-msg error';
        msg.textContent = data.error || 'Something went wrong.';
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
  nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') enter(); });

  wrap.querySelector('#welcome-skip').addEventListener('click', () => {
    markDismissed();
    wrap.remove();
  });

  wrap.querySelector('#welcome-login').addEventListener('click', () => {
    markDismissed();
    wrap.remove();
    _openLogin();
  });

  setTimeout(() => nameInput.focus(), 120);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
