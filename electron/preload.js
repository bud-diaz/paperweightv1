'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Exposed to the setup wizard renderer only (electron/renderer/setup.html).
// The main dashboard window loads the server's own creator.html directly and
// does not need this bridge — it authenticates against the server like the
// web build does, just automatically (see electron/main.js + dashboard auto-unlock
// handled server-side via the existing dashboard session/token flow).
contextBridge.exposeInMainWorld('electronAPI', {
  submitSetup: formData => ipcRenderer.invoke('setup:submit', formData),
  chooseVaultFolder: () => ipcRenderer.invoke('setup:choose-folder'),
});
