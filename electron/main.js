'use strict';

const { app, BrowserWindow, session } = require('electron');
const fs = require('fs');
const path = require('path');
const http = require('http');

// Must happen before src/config.js (and src/index.js, which requires it) are
// ever required — config.js reads process.env at module-load time.
process.env.PAPERWEIGHT_ELECTRON = 'true';
process.env.PAPERWEIGHT_DATA_ROOT = app.getPath('userData');

const dataRoot = process.env.PAPERWEIGHT_DATA_ROOT;
const envPath = path.join(dataRoot, '.env');

// better-sqlite3's native binary in the shared ../node_modules is built
// against the host Node's ABI (used by `npm test`/`node src/index.js`/pkg),
// not Electron's. Rather than rebuild that shared copy in place — which
// would break the plain-Node path the moment anyone runs the Electron app —
// `npm run electron:rebuild` (electron/scripts/rebuild-native.js) maintains
// an isolated Electron-ABI build at electron/native/node_modules/better-sqlite3.
// Redirect resolution to it here when running from source. Packaged builds
// don't need this: electron-builder's extraResources overlay (see
// electron/package.json) places the Electron-ABI build directly inside the
// packaged node_modules, where normal resolution already finds it.
if (!app.isPackaged) {
  const Module = require('module');
  const nativeBetterSqlite3 = path.join(__dirname, 'native', 'node_modules', 'better-sqlite3');
  const originalResolveFilename = Module._resolveFilename;
  Module._resolveFilename = function (request, ...rest) {
    if (request === 'better-sqlite3') {
      return originalResolveFilename.call(this, nativeBetterSqlite3, ...rest);
    }
    return originalResolveFilename.call(this, request, ...rest);
  };
}

const { openSetupWindow } = require('./setup-window');

let mainWindow = null;
let serverApp = null;

// Logs the desktop window in automatically so the operator never has to paste
// the dashboard token. Performs the same login request the web client would,
// then transplants the resulting session cookie into the window's session
// before the page loads. Best-effort: if 2FA is enabled, login returns no
// session cookie and the user just sees the normal token/2FA gate instead.
async function autoUnlockDashboard(config) {
  const setCookie = await new Promise(resolve => {
    const req = http.request({
      host: config.host,
      port: config.port,
      path: '/api/auth/dashboard/login',
      method: 'POST',
      headers: { 'X-Dashboard-Token': config.auth.dashboardToken },
    }, res => {
      res.resume();
      resolve(res.headers['set-cookie'] || null);
    });
    req.on('error', () => resolve(null));
    req.end();
  });
  if (!setCookie) return;

  const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const match = /^pw_dashboard_session=([^;]+)/.exec(cookieHeader);
  if (!match) return;

  await session.defaultSession.cookies.set({
    url: `http://${config.host}:${config.port}`,
    name: 'pw_dashboard_session',
    value: match[1],
    httpOnly: true,
    sameSite: 'strict',
    expirationDate: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
  });
}

async function openMainWindow() {
  const config = require('../src/config');

  await autoUnlockDashboard(config).catch(() => {});

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    title: config.station.name || 'Paperweight',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(`http://${config.host}:${config.port}/creator.html?desktop=1`);
}

async function startServerAndOpenWindow() {
  serverApp = require('../src/index');
  await serverApp.start();
  await openMainWindow();
}

// Called by the setup wizard (via IPC) once .env has been provisioned.
function onSetupComplete() {
  startServerAndOpenWindow().catch(err => {
    console.error('[Paperweight] Failed to start after setup:', err);
    app.quit();
  });
}

function boot() {
  if (fs.existsSync(envPath)) {
    startServerAndOpenWindow().catch(err => {
      console.error('[Paperweight] Failed to start:', err);
      app.quit();
    });
  } else {
    openSetupWindow({ dataRoot, onComplete: onSetupComplete });
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(boot);

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    if (serverApp) {
      try { serverApp.shutdown(); } catch {}
    }
  });
}
