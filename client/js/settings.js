/**
 * settings.js — Listener Settings modal + its top-bar dropdown entry point.
 *
 * The Account section inside the modal (#auth-toggle/#auth-body and
 * everything nested in it) is the same DOM subtree auth.js has always driven
 * — it was relocated from the old share-drawer "ACCOUNT" panel into this
 * modal, but every id auth.js looks up via el() still exists, so none of
 * auth.js's wiring changed. This module only owns the modal chrome (open/
 * close, the dropdown trigger) and the parts that are new here: the email
 * verification status/resend row and the preferences checkbox.
 *
 * Exports: openSettingsModal, closeSettingsModal, renderSettingsModal,
 *          initSettingsHandlers.
 */

import { authState } from './state.js';
import { el } from './utils.js';
import * as api from './api.js';

let _toggleAuthSection = () => {};
let _logoutListener = async () => {};
let _maybeShowTour = () => {};

/**
 * @param {{ toggleAuthSection: (force?: boolean) => void, logoutListener: () => Promise<void>, maybeShowTour: () => void }} cbs
 */
export function init({ toggleAuthSection, logoutListener, maybeShowTour } = {}) {
  if (toggleAuthSection) _toggleAuthSection = toggleAuthSection;
  if (logoutListener) _logoutListener = logoutListener;
  if (maybeShowTour) _maybeShowTour = maybeShowTour;
}

export function openSettingsModal() {
  closeSettingsDropdown();
  el('settings-backdrop').classList.add('open');
  _toggleAuthSection(true);
  renderSettingsModal();
}

export function closeSettingsModal() {
  el('settings-backdrop').classList.remove('open');
  // Catches the common case: a listener registers from inside Settings (its
  // only entry point today), so the tour was skipped while the modal was
  // open — this is the first moment after that it's safe to show it.
  _maybeShowTour();
}

function toggleSettingsDropdown(force) {
  const dd = el('pw-settings-dropdown');
  const show = force !== undefined ? force : dd.hidden;
  dd.hidden = !show;
}

function closeSettingsDropdown() {
  toggleSettingsDropdown(false);
}

export function renderSettingsModal() {
  const hasAccount = authState.loggedIn && authState.hasAccount;

  el('settings-verify-row').hidden = !hasAccount;
  if (hasAccount) {
    const statusEl = el('settings-verify-status');
    statusEl.textContent = authState.emailVerified ? 'Email verified ✓' : 'Email not verified yet';
    statusEl.className = authState.emailVerified ? 'settings-verified' : 'settings-unverified';
    el('settings-resend-btn').hidden = authState.emailVerified;
  }

  el('settings-preferences-section').hidden = !hasAccount;
  if (hasAccount) {
    el('settings-marketing-checkbox').checked = !!authState.marketingOptIn;
  }

  el('pw-settings-logout-btn').hidden = !authState.loggedIn;
}

async function handleResendVerification() {
  const btn = el('settings-resend-btn');
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = '…';
  try {
    await api.auth.resendVerification();
    btn.textContent = 'SENT';
    setTimeout(() => { btn.textContent = original; btn.disabled = false; }, 3000);
  } catch {
    btn.textContent = original;
    btn.disabled = false;
  }
}

async function handleMarketingToggle(e) {
  const checked = e.target.checked;
  try {
    const { res } = await api.auth.updatePreferences({ marketingOptIn: checked });
    if (res.ok) authState.marketingOptIn = checked;
  } catch {
    e.target.checked = !checked;
  }
}

// ── Event wiring (called from main.js in Phase 8) ─────────────────────────────

export function initSettingsHandlers() {
  el('pw-settings-btn').addEventListener('click', e => {
    e.stopPropagation();
    toggleSettingsDropdown();
  });
  document.addEventListener('click', e => {
    const dd = el('pw-settings-dropdown');
    if (!dd.hidden && !dd.contains(e.target) && e.target !== el('pw-settings-btn')) {
      closeSettingsDropdown();
    }
  });
  el('pw-settings-open-btn').addEventListener('click', openSettingsModal);
  el('pw-settings-logout-btn').addEventListener('click', () => {
    closeSettingsDropdown();
    _logoutListener();
  });
  el('account-panel-open-settings-btn').addEventListener('click', openSettingsModal);

  el('settings-modal-close').addEventListener('click', closeSettingsModal);
  el('settings-backdrop').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeSettingsModal();
  });

  el('settings-resend-btn').addEventListener('click', handleResendVerification);
  el('settings-marketing-checkbox').addEventListener('change', handleMarketingToggle);
}
