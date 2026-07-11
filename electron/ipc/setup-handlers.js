'use strict';

const { ipcMain, dialog } = require('electron');

const { provisionEnv } = require('../../src/setup/provision');

const SETUP_CHANNELS = ['setup:choose-folder', 'setup:submit', 'setup:close'];

function unregisterSetupHandlers() {
  for (const channel of SETUP_CHANNELS) {
    ipcMain.removeHandler(channel);
  }
}

function isSetupSender(event) {
  const url = event.senderFrame?.url || '';
  return url.startsWith('file://') && /\/renderer\/setup\.html$/i.test(url.replace(/\\/g, '/'));
}

// Wires the setup wizard's IPC calls (see electron/preload.js) to the shared
// provisioning module. Registered once per setup window — boot() only opens
// one setup window per app run.
function registerSetupHandlers({ dataRoot, win, onComplete }) {
  unregisterSetupHandlers();

  ipcMain.handle('setup:choose-folder', async event => {
    if (!isSetupSender(event)) return null;
    const result = await dialog.showOpenDialog(win, {
      title: 'Choose vault folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('setup:submit', async (event, formData) => {
    if (!isSetupSender(event)) return { ok: false, error: 'Invalid setup window' };
    try {
      const result = provisionEnv(formData || {}, dataRoot);
      return { ok: true, dashboardToken: result.dashboardToken };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Called by the renderer after the user has acknowledged the dashboard
  // token. Closes the setup window and hands off to the main app.
  ipcMain.handle('setup:close', async event => {
    if (!isSetupSender(event)) return;
    unregisterSetupHandlers();
    win.close();
    onComplete();
  });
}

module.exports = { registerSetupHandlers };
