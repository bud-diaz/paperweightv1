'use strict';

const { BrowserWindow } = require('electron');
const path = require('path');

const { registerSetupHandlers } = require('./ipc/setup-handlers');

// Creates the first-run wizard window. No server/port exists yet at this
// point — the wizard only writes .env + creates directories via provisionEnv().
function openSetupWindow({ dataRoot, onComplete }) {
  const win = new BrowserWindow({
    width: 720,
    height: 760,
    resizable: false,
    title: 'Paperweight Setup',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  registerSetupHandlers({ dataRoot, win, onComplete });

  win.loadFile(path.join(__dirname, 'renderer', 'setup.html'));

  return win;
}

module.exports = { openSetupWindow };
