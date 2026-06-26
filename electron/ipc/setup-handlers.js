'use strict';

const { ipcMain, dialog } = require('electron');

const { provisionEnv } = require('../../src/setup/provision');

// Wires the setup wizard's IPC calls (see electron/preload.js) to the shared
// provisioning module. Registered once per setup window — boot() only opens
// one setup window per app run.
function registerSetupHandlers({ dataRoot, win, onComplete }) {
  ipcMain.handle('setup:choose-folder', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Choose vault folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('setup:submit', async (event, formData) => {
    try {
      const result = provisionEnv(formData || {}, dataRoot);
      return { ok: true, dashboardToken: result.dashboardToken };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Called by the renderer after the user has acknowledged the dashboard
  // token. Closes the setup window and hands off to the main app.
  ipcMain.handle('setup:close', async () => {
    win.close();
    onComplete();
  });
}

module.exports = { registerSetupHandlers };
