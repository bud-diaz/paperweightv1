'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Exposed to the setup wizard renderer only (electron/renderer/setup.html).
// The main dashboard window loads the server's own Studio build directly and
// does not need this bridge for auth — it authenticates against the server
// like the web build does, just automatically (see electron/main.js +
// dashboard auto-unlock handled server-side via the existing dashboard
// session/token flow).
const isSetupWindow =
  window.location.protocol === 'file:'
  && /\/renderer\/setup\.html$/i.test(window.location.pathname.replace(/\\/g, '/'));

if (isSetupWindow) {
  contextBridge.exposeInMainWorld('electronAPI', {
    getDefaultDataRoot: () => ipcRenderer.invoke('setup:get-data-root'),
    chooseDataRoot: () => ipcRenderer.invoke('setup:choose-data-root'),
    submitSetup: formData => ipcRenderer.invoke('setup:submit', formData),
    chooseVaultFolder: () => ipcRenderer.invoke('setup:choose-folder'),
    downloadToken: token => ipcRenderer.invoke('setup:download-token', token),
    closeSetup: () => ipcRenderer.invoke('setup:close'),
  });
} else {
  // Main dashboard window — desktop-only power/update/uninstall controls and
  // vault folder import (see electron/ipc/app-handlers.js + vault-handlers.js).
  contextBridge.exposeInMainWorld('desktopAPI', {
    quitApp: () => ipcRenderer.invoke('app:quit'),
    restartServer: () => ipcRenderer.invoke('app:restart'),
    checkForUpdates: () => ipcRenderer.invoke('app:check-for-updates'),
    uninstall: confirmPhrase => ipcRenderer.invoke('app:uninstall', confirmPhrase),
    importFolder: () => ipcRenderer.invoke('vault:import-folder'),
  });
}
