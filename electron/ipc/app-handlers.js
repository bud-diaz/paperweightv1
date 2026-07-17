'use strict';

const { ipcMain, shell } = require('electron');

const { checkForUpdates } = require('../../src/updates/checkForUpdates');
const { runUninstall } = require('../../src/uninstall/runUninstall');

// Wires the desktop power/update/uninstall controls (see client/js/dashboard/
// desktop-controls.js + electron/preload.js's window.desktopAPI) to the
// Electron main process. Business logic stays in src/ modules — this file
// only adapts them to ipcMain, matching how electron/ipc/setup-handlers.js
// delegates to src/setup/provision.js.
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
      return await runUninstall({ serverApp, config, quit: quitApp, desktopPath, autostartFile });
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}

module.exports = { registerAppHandlers };
