'use strict';

const { BrowserWindow } = require('electron');
const path = require('path');

const { registerSetupHandlers } = require('./ipc/setup-handlers');

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
    },
  });

  win.once('ready-to-show', () => win.show());

  registerSetupHandlers({ dataRoot, win, onComplete });

  win.loadFile(path.join(__dirname, 'renderer', 'setup.html'));

  return win;
}

module.exports = { openSetupWindow };
