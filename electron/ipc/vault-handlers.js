'use strict';

const { ipcMain, dialog } = require('electron');

const { importFolder } = require('../../src/collections/collections');

// Wires the dashboard's "Import folder…" button (client/js/dashboard/
// projects.js) to a native folder picker + the vault import logic.
function registerVaultHandlers({ win }) {
  ipcMain.handle('vault:import-folder', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Choose a folder to import',
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths.length) return null;

    try {
      return await importFolder(result.filePaths[0]);
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}

module.exports = { registerVaultHandlers };
