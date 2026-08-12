'use strict';

const { ipcMain, shell } = require('electron');

const { checkForUpdates } = require('../../src/updates/checkForUpdates');

// Wires the desktop power/update/uninstall controls to the Electron main
// process via electron/preload.js's window.desktopAPI bridge. Business logic
// stays in src/ modules — this file only adapts them to ipcMain, matching
// how electron/ipc/setup-handlers.js delegates to src/setup/provision.js.
//
// The Studio dashboard (studio/, client/app/) has no frontend UI calling
// window.desktopAPI yet — the vanilla-JS UI that called it
// (client/js/dashboard/desktop-controls.js) was retired in the
// creator.html -> Studio cutover without a replacement. This bridge is kept
// wired and ready; a future pass needs to add the equivalent controls to
// studio/src (see CLAUDE.md's Creator Studio section for the tracked gap).
function registerAppHandlers({ serverApp, config, quitApp, restartApp, autostartFile, desktopPath }) {
  ipcMain.handle('app:quit', () => {
    quitApp();
  });

  ipcMain.handle('app:restart', async () => {
    await restartApp();
  });

  ipcMain.handle('app:check-for-updates', async () => {
    const result = await checkForUpdates(config.version);
    if (result.updateAvailable) {
      shell.openExternal(result.releaseUrl);
    }
    return result;
  });

  ipcMain.handle('app:uninstall', async (event, confirmPhrase) => {
    if (confirmPhrase !== config.station.name) {
      return { ok: false, error: 'Confirmation text did not match.' };
    }
    try {
      // This module reaches into the initialized database/config runtime.
      // Keep it out of the first-launch import graph so the setup wizard can
      // create .env before src/config.js is loaded.
      const { runUninstall } = require('../../src/uninstall/runUninstall');
      return await runUninstall({ serverApp, config, quit: quitApp, desktopPath, autostartFile });
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}

module.exports = { registerAppHandlers };
