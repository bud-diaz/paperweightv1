'use strict';

const { BrowserWindow, shell } = require('electron');
const path = require('path');

const { registerSetupHandlers } = require('./ipc/setup-handlers');
const { isTrustedSetupUrl, safeOpenExternal } = require('./security');

// Creates the first-run wizard window. No server/port exists yet at this
// point — the wizard only writes .env + creates directories via provisionEnv().
function openSetupWindow({ dataRoot, onComplete, icon }) {
  const win = new BrowserWindow({
    width: 720,
    height: 760,
    resizable: false,
    title: 'Paperweight Setup',
    icon,
    // Matches setup.css's body background so there's no flash of stark white
    // between window creation and first paint (see main.js's mainWindow for
    // the same treatment on the dashboard window).
    backgroundColor: '#0c0c0f',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (isTrustedSetupUrl(url)) return;
    event.preventDefault();
    safeOpenExternal(shell, url);
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    safeOpenExternal(shell, url);
    return { action: 'deny' };
  });

  win.once('ready-to-show', () => win.show());

  registerSetupHandlers({ dataRoot, win, onComplete });

  win.loadFile(path.join(__dirname, 'renderer', 'setup.html'));

  return win;
}

module.exports = { openSetupWindow };
