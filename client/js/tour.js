/**
 * tour.js — One-time spotlight pointing new listener accounts at Settings.
 *
 * No existing tour/walkthrough component exists elsewhere in this codebase to
 * extend, so this is a small, self-contained, single-target implementation:
 * dim the page, cut out the Settings button in the top bar, show a short
 * tooltip, dismiss on click. "Seen" state is persisted server-side
 * (listener_accounts.settings_tour_seen_at) so it survives across devices and
 * is shown exactly once per account, ever.
 *
 * Exports: init, maybeShowSettingsTour.
 */

import { authState } from './state.js';
import { el } from './utils.js';
import * as api from './api.js';

// No cross-module callbacks needed today — present for the same
// forward-compatibility reason several other modules have a no-op init().
export function init() {}

export async function maybeShowSettingsTour() {
  if (!authState.loggedIn || !authState.hasAccount || authState.settingsTourSeenAt) return;
  if (document.getElementById('settings-tour-overlay')) return;
  // Skip if Settings is already open — most commonly right after registering
  // from inside it. The whole point of the spotlight is to help a listener
  // find Settings; someone already inside it has nothing left to discover.
  const settingsModal = document.getElementById('settings-backdrop');
  if (settingsModal && settingsModal.classList.contains('open')) return;

  const target = el('pw-settings-btn');
  if (!target) return;
  const rect = target.getBoundingClientRect();
  if (!rect.width) return; // not visible (e.g. mobile layout hides it) — skip silently

  const pad = 6;
  const overlay = document.createElement('div');
  overlay.id = 'settings-tour-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9998;';
  overlay.innerHTML = `
    <div id="settings-tour-cutout" style="
      position:fixed; left:${rect.left - pad}px; top:${rect.top - pad}px;
      width:${rect.width + pad * 2}px; height:${rect.height + pad * 2}px;
      border-radius:8px; box-shadow:0 0 0 2000px rgba(0,0,0,.78), 0 0 0 2px #39ff14;
      pointer-events:none;
    "></div>
    <div id="settings-tour-tooltip" style="
      position:fixed; left:${rect.left}px; top:${rect.bottom + pad + 8}px;
      max-width:220px; background:#0d0d0d; border:1px solid rgba(255,255,255,.14);
      border-radius:10px; padding:14px; font-family:'Space Mono',monospace;
    ">
      <div style="font-size:12px; color:rgba(255,255,255,.85); line-height:1.5; margin-bottom:10px;">
        New: manage your account, email verification, and preferences here.
      </div>
      <button id="settings-tour-dismiss" style="
        background:#39ff14; border:none; border-radius:6px; padding:7px 14px;
        font-family:'Space Mono',monospace; font-size:11px; letter-spacing:.06em;
        color:#000; cursor:pointer;
      ">GOT IT</button>
    </div>`;
  document.body.appendChild(overlay);

  async function dismiss() {
    overlay.remove();
    authState.settingsTourSeenAt = new Date().toISOString();
    try { await api.auth.settingsTourSeen(); } catch {}
  }

  overlay.querySelector('#settings-tour-dismiss').addEventListener('click', dismiss);
}
