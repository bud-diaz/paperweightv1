/**
 * dashboard/twofa.js — Two-factor authentication setup and management.
 */

import * as api from '../api.js';
import { el } from '../utils.js';

export function init() {}

export async function loadDash2FA() {
  try {
    const data      = await api.dashboard.twoFA.status();
    const statusRow = el('dash-2fa-status-row');
    el('dash-2fa-setup-panel').hidden   = true;
    el('dash-2fa-codes-panel').hidden   = true;
    el('dash-2fa-disable-panel').hidden = true;

    if (data.enabled) {
      statusRow.innerHTML = '<span style="color:#39ff14;">● 2FA ENABLED</span> — Token + authenticator code required to sign in.';
      el('dash-2fa-disable-panel').hidden = false;
    } else {
      statusRow.innerHTML = '<span style="color:rgba(255,255,255,.3);">○ 2FA DISABLED</span> — Protected by token only. <button class="mgmt-btn" id="btn-2fa-start" style="margin-left:6px;padding:3px 10px;font-size:10px;">ENABLE</button>';
      document.getElementById('btn-2fa-start').addEventListener('click', startTwoFASetup);
    }
  } catch {}
}

export async function startTwoFASetup() {
  try {
    const data = await api.dashboard.twoFA.setup();
    el('dash-2fa-secret-box').textContent = data.secret;
    el('dash-2fa-confirm-input').value    = '';
    el('dash-2fa-setup-msg').textContent  = '';
    el('dash-2fa-setup-panel').hidden     = false;
    el('dash-2fa-status-row').textContent = 'Scan this secret with your authenticator app, then enter the code to activate.';
  } catch {}
}

export function initTwoFAHandlers() {
  el('btn-2fa-confirm').addEventListener('click', async () => {
    const code = el('dash-2fa-confirm-input').value.trim();
    if (!code) return;
    el('btn-2fa-confirm').textContent = 'ENABLING…';
    el('btn-2fa-confirm').disabled    = true;
    try {
      const { res, data } = await api.dashboard.twoFA.confirm(code);
      if (!res.ok) {
        el('dash-2fa-setup-msg').className   = 'dash-error-msg';
        el('dash-2fa-setup-msg').textContent = data.error || 'Failed';
        return;
      }
      el('dash-2fa-setup-panel').hidden      = true;
      el('dash-2fa-codes-list').textContent  = data.recoveryCodes.join('\n');
      el('dash-2fa-codes-panel').hidden      = false;
    } catch {
      el('dash-2fa-setup-msg').className   = 'dash-error-msg';
      el('dash-2fa-setup-msg').textContent = 'Error';
    } finally {
      el('btn-2fa-confirm').textContent = 'ENABLE 2FA';
      el('btn-2fa-confirm').disabled    = false;
    }
  });

  el('btn-2fa-codes-done').addEventListener('click', () => {
    el('dash-2fa-codes-panel').hidden = true;
    loadDash2FA();
  });

  el('btn-2fa-disable').addEventListener('click', async () => {
    const code = el('dash-2fa-disable-input').value.trim();
    if (!code) return;
    el('btn-2fa-disable').textContent = 'DISABLING…';
    el('btn-2fa-disable').disabled    = true;
    try {
      const { res, data } = await api.dashboard.twoFA.disable(code);
      if (!res.ok) {
        el('dash-2fa-disable-msg').className   = 'dash-error-msg';
        el('dash-2fa-disable-msg').textContent = data.error || 'Failed';
        return;
      }
      el('dash-2fa-disable-input').value = '';
      loadDash2FA();
    } catch {
      el('dash-2fa-disable-msg').className   = 'dash-error-msg';
      el('dash-2fa-disable-msg').textContent = 'Error';
    } finally {
      el('btn-2fa-disable').textContent = 'DISABLE 2FA';
      el('btn-2fa-disable').disabled    = false;
    }
  });
}
