/**
 * dashboard/desktop-controls.js — Desktop-only power/update/uninstall
 * items, flattened into the settings-gear dropdown below DOCS (see
 * #desktop-power-items in client/creator.html and settings.js).
 *
 * Talks to window.desktopAPI (electron/preload.js) for anything that only
 * the Electron main process can do (quit, restart, check for updates,
 * uninstall), and to the normal cookie-authenticated dashboard API for
 * broadcast stop/restart, same as every other dashboard control.
 */

import { el, showToast } from '../utils.js';
import * as api from '../api.js';
import { closeSettingsDropdown } from '../settings.js';

export function init() {}

// Tunnel connect/disconnect — dulled until a managed public tunnel is set,
// fed by station.js's loadDashStation() (same GET /api/dashboard/station
// response the Station panel already fetches, no extra round trip).
let tunnelConfigured = false;
let tunnelPaused = false;

export function applyTunnelState(data) {
  tunnelConfigured = !!(data.requirements && data.requirements.cloudflareTunnel);
  tunnelPaused = !!data.cloudflareTunnelPaused;
  updateTunnelButton();
}

function updateTunnelButton() {
  const btn = el('dp-toggle-tunnel');
  if (!btn) return;
  btn.disabled = !tunnelConfigured;
  btn.textContent = tunnelPaused ? 'RECONNECT TUNNEL' : 'DISCONNECT TUNNEL';
  btn.title = tunnelConfigured ? '' : 'Set up a public tunnel in the Station panel first';
}

async function toggleTunnel() {
  if (!tunnelConfigured) return;
  const disconnecting = !tunnelPaused;
  const msg = disconnecting
    ? "Disconnect the public tunnel? Your station will be unreachable from outside until you reconnect it."
    : 'Reconnect the public tunnel?';
  if (!confirm(msg)) return;
  closeSettingsDropdown();

  const { res, data } = disconnecting
    ? await api.dashboard.station.tunnelDisconnect()
    : await api.dashboard.station.tunnelConnect();

  if (!res.ok) {
    showToast(data.error || 'Could not update the tunnel');
    return;
  }
  tunnelPaused = !!data.paused;
  updateTunnelButton();
  showToast(tunnelPaused ? 'Tunnel disconnected — station is local-only' : 'Tunnel reconnected — station is public again');
}

async function stopBroadcast() {
  if (!confirm('Stop the broadcast?')) return;
  closeSettingsDropdown();
  await api.dashboard.broadcast.stop();
  showToast('Broadcast stopped');
}

async function restartBroadcast() {
  if (!confirm('Restart the broadcast?')) return;
  closeSettingsDropdown();
  await api.dashboard.broadcast.restart();
  showToast('Broadcast restarting…');
}

async function stopServer() {
  if (!window.desktopAPI) return;
  if (!confirm('Quit Paperweight? The broadcast and dashboard will stop.')) return;
  closeSettingsDropdown();
  window.desktopAPI.quitApp();
}

async function restartServer() {
  if (!window.desktopAPI) return;
  if (!confirm('Restart Paperweight? The broadcast and dashboard will briefly go offline.')) return;
  closeSettingsDropdown();
  showToast('Restarting…');
  window.desktopAPI.restartServer();
}

async function stopBoth() {
  if (!window.desktopAPI) return;
  if (!confirm('Stop the broadcast and quit Paperweight?')) return;
  closeSettingsDropdown();
  try { await api.dashboard.broadcast.stop(); } catch {}
  window.desktopAPI.quitApp();
}

async function checkForUpdates() {
  if (!window.desktopAPI) return;
  const result = await window.desktopAPI.checkForUpdates();
  if (result?.error) {
    showToast('Could not check for updates');
  } else if (result?.updateAvailable) {
    showToast(`Update available: v${result.latestVersion} — opening release page…`);
  } else {
    showToast("You're on the latest version");
  }
}

// A custom modal, not window.prompt() — Electron's renderer only implements
// window.alert()/window.confirm() natively; window.prompt() returns null
// immediately with no UI, which silently no-ops this whole flow.
function openUninstallModal() {
  if (!window.desktopAPI) return;
  const stationName = window._stationName || '';
  el('uninstall-modal-label').textContent = `Type your station name to confirm: ${stationName}`;
  el('uninstall-confirm-input').value = '';
  el('uninstall-modal-backdrop').classList.add('open');
}

function closeUninstallModal() {
  el('uninstall-modal-backdrop').classList.remove('open');
}

async function confirmUninstall() {
  const stationName = window._stationName || '';
  const phrase = el('uninstall-confirm-input').value;
  if (phrase !== stationName) {
    showToast('Confirmation text did not match — nothing was deleted');
    return;
  }
  closeUninstallModal();
  showToast('Exporting and uninstalling…');
  const result = await window.desktopAPI.uninstall(phrase);
  if (result && result.ok === false) {
    showToast(`Uninstall failed: ${result.error}`);
  }
  // On success the app quits on its own — no further UI to update.
}

export function initDesktopControlsHandlers() {
  if (!el('dp-stop-broadcast')) return;

  // Click-outside-to-close and the trigger button are owned by settings.js
  // (#pw-settings-dropdown) — these items just live inside that same menu.
  el('dp-stop-broadcast').addEventListener('click', stopBroadcast);
  el('dp-restart-broadcast').addEventListener('click', restartBroadcast);
  el('dp-toggle-tunnel').addEventListener('click', toggleTunnel);
  el('dp-stop-server').addEventListener('click', stopServer);
  el('dp-restart-server').addEventListener('click', restartServer);
  el('dp-stop-both').addEventListener('click', stopBoth);
  el('desktop-update-btn').addEventListener('click', checkForUpdates);
  el('desktop-uninstall-btn').addEventListener('click', openUninstallModal);

  el('uninstall-modal-close').addEventListener('click', closeUninstallModal);
  el('uninstall-modal-cancel').addEventListener('click', closeUninstallModal);
  el('uninstall-modal-confirm').addEventListener('click', confirmUninstall);
  el('uninstall-modal-backdrop').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeUninstallModal();
  });
}
