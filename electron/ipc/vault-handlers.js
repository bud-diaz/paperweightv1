'use strict';

const { ipcMain, dialog } = require('electron');

// Wires a native folder picker + the vault import logic to
// window.desktopAPI.importFolder (electron/preload.js). No Studio dashboard
// UI calls this yet — the vanilla-JS "Import folder…" button
// (client/js/dashboard/projects.js) was retired in the creator.html ->
// Studio cutover without a replacement; see CLAUDE.md's Creator Studio
// section for the tracked gap. Handler stays wired and ready.
function registerVaultHandlers({ win }) {
  ipcMain.handle('vault:import-folder', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Choose a folder to import',
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths.length) return null;

    try {
      // Collection imports depend on the initialized database/config runtime.
      // Resolve them only after setup has created .env and the server is up.
      const { importFolder } = require('../../src/collections/collections');
      return await importFolder(result.filePaths[0]);
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}

module.exports = { registerVaultHandlers };
