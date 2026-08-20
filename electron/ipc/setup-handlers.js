'use strict';

const { app, ipcMain, dialog } = require('electron');
const fs = require('fs');
const path = require('path');

const { provisionEnv } = require('../../src/setup/provision');
const { isTrustedSetupUrl } = require('../security');

const SETUP_CHANNELS = [
  'setup:get-data-root',
  'setup:choose-data-root',
  'setup:choose-folder',
  'setup:submit',
  'setup:download-token',
  'setup:close',
];

function unregisterSetupHandlers() {
  for (const channel of SETUP_CHANNELS) {
    ipcMain.removeHandler(channel);
  }
}

function isSetupSender(event) {
  return isTrustedSetupUrl(event.senderFrame?.url || '');
}

// Wires the setup wizard's IPC calls (see electron/preload.js) to the shared
// provisioning module. Registered once per setup window — boot() only opens
// one setup window per app run.
function registerSetupHandlers({ dataRoot, win, onComplete }) {
  unregisterSetupHandlers();

  ipcMain.handle('setup:get-data-root', async event => {
    if (!isSetupSender(event)) return null;
    return dataRoot;
  });

  ipcMain.handle('setup:choose-data-root', async event => {
    if (!isSetupSender(event)) return null;
    const result = await dialog.showOpenDialog(win, {
      title: 'Choose Paperweight data folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });

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
      const targetDataRoot = formData && formData.dataRoot ? path.resolve(formData.dataRoot) : dataRoot;
      const result = provisionEnv(formData || {}, targetDataRoot);

      // The fixed, OS-standard userData path is the one location every future
      // launch of electron/main.js can always find without prior knowledge —
      // so a custom data root gets recorded there as a pointer.
      const fixedDefaultRoot = app.getPath('userData');
      if (targetDataRoot !== fixedDefaultRoot) {
        fs.mkdirSync(fixedDefaultRoot, { recursive: true });
        fs.writeFileSync(
          path.join(fixedDefaultRoot, 'data-root.json'),
          JSON.stringify({ dataRoot: targetDataRoot })
        );
      }

      return { ok: true, dashboardToken: result.dashboardToken };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('setup:download-token', async (event, token) => {
    if (!isSetupSender(event)) return false;
    const result = await dialog.showSaveDialog(win, {
      title: 'Save dashboard token',
      defaultPath: 'paperweight-dashboard-token.txt',
      filters: [{ name: 'Text Files', extensions: ['txt'] }],
    });
    if (result.canceled || !result.filePath) return false;
    fs.writeFileSync(result.filePath, token, 'utf8');
    return true;
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
