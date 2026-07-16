/**
 * dashboard/desktop-controls.js — Desktop-only power/update/uninstall
 * cluster (floating overlay, bottom-right, outside the player panel).
 *
 * Talks to window.desktopAPI (electron/preload.js) for anything that only
 * the Electron main process can do (quit, restart, check for updates,
 * uninstall), and to the normal cookie-authenticated dashboard API for
 * broadcast stop/restart, same as every other dashboard control.
 */

import { el, showToast } from '../utils.js';
import * as api from '../api.js';

export function init() {}

function toggleDropdown(force) {
  const dd = el('desktop-power-dropdown');
  const show = force !== undefined ? force : dd.hidden;
  dd.hidden = !show;
}

function closeDropdown() {
  toggleDropdown(false);
}

async function stopBroadcast() {
  if (!confirm('Stop the broadcast?')) return;
  closeDropdown();
  await api.dashboard.broadcast.stop();
  showToast('Broadcast stopped');
}

async function restartBroadcast() {
  if (!confirm('Restart the broadcast?')) return;
  closeDropdown();
  await api.dashboard.broadcast.restart();
  showToast('Broadcast restarting…');
}

async function stopServer() {
  if (!window.desktopAPI) return;
  if (!confirm('Quit Paperweight? The broadcast and dashboard will stop.')) return;
  closeDropdown();
  window.desktopAPI.quitApp();
}

async function restartServer() {
  if (!window.desktopAPI) return;
  if (!confirm('Restart Paperweight? The broadcast and dashboard will briefly go offline.')) return;
  closeDropdown();
  showToast('Restarting…');
  window.desktopAPI.restartServer();
}

async function stopBoth() {
  if (!window.desktopAPI) return;
  if (!confirm('Stop the broadcast and quit Paperweight?')) return;
  closeDropdown();
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

async function uninstall() {
  if (!window.desktopAPI) return;
  const stationName = window._stationName || '';
  const phrase = prompt(
    `This will export your data to your Desktop, then permanently delete all Paperweight data and quit.\n\nType your station name to confirm: ${stationName}`
  );
  if (phrase === null) return;
  if (phrase !== stationName) {
    showToast('Confirmation text did not match — nothing was deleted');
    return;
  }
  showToast('Exporting and uninstalling…');
  const result = await window.desktopAPI.uninstall(phrase);
  if (result && result.ok === false) {
    showToast(`Uninstall failed: ${result.error}`);
  }
  // On success the app quits on its own — no further UI to update.
}

export function initDesktopControlsHandlers() {
  const cluster = el('desktop-power-cluster');
  if (!cluster) return;

  el('desktop-power-btn').addEventListener('click', e => {
    e.stopPropagation();
    toggleDropdown();
  });
  document.addEventListener('click', e => {
    const dd = el('desktop-power-dropdown');
    if (!dd.hidden && !dd.contains(e.target) && e.target !== el('desktop-power-btn')) {
      closeDropdown();
    }
  });

  el('dp-stop-broadcast').addEventListener('click', stopBroadcast);
  el('dp-restart-broadcast').addEventListener('click', restartBroadcast);
  el('dp-stop-server').addEventListener('click', stopServer);
  el('dp-restart-server').addEventListener('click', restartServer);
  el('dp-stop-both').addEventListener('click', stopBoth);
  el('desktop-update-btn').addEventListener('click', checkForUpdates);
  el('desktop-uninstall-btn').addEventListener('click', uninstall);
}
