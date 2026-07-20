'use strict';

const { app, BrowserWindow, session, Tray, Menu, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const http = require('http');

// Must happen before src/config.js (and src/index.js, which requires it) are
// ever required — config.js reads process.env at module-load time.
process.env.PAPERWEIGHT_ELECTRON = 'true';
process.env.PAPERWEIGHT_DATA_ROOT = (!app.isPackaged && process.env.PAPERWEIGHT_DATA_ROOT)
  ? path.resolve(process.env.PAPERWEIGHT_DATA_ROOT)
  : app.getPath('userData');
if (app.isPackaged) {
  process.env.PAPERWEIGHT_DESKTOP_RUNTIME = 'true';
}

const dataRoot = process.env.PAPERWEIGHT_DATA_ROOT;
const envPath = path.join(dataRoot, '.env');
const windowIcon = path.join(__dirname, 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png');

// Keep Windows notifications, taskbar grouping, and development builds under
// Paperweight's identity instead of Electron's default application identity.
if (process.platform === 'win32') {
  app.setAppUserModelId('com.paperweight.desktop');
}

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
const { registerAppHandlers } = require('./ipc/app-handlers');
const { registerVaultHandlers } = require('./ipc/vault-handlers');

let mainWindow = null;
let serverApp = null;
let tray = null;
let isQuitting = false;

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
    icon: windowIcon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  registerAppHandlers({
    serverApp,
    config,
    quitApp,
    restartApp,
    autostartFile: linuxAutostartFile,
    desktopPath: app.getPath('desktop'),
  });
  registerVaultHandlers({ win: mainWindow });

  // The broadcast keeps running whether the window is open or not — closing
  // it should hide the app to the tray, not stop the station. Only the tray's
  // "Quit Paperweight" (or platform quit shortcuts, which set isQuitting via
  // the 'before-quit' handler) should actually tear the app down.
  mainWindow.on('close', event => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow.hide();
  });

  mainWindow.loadURL(`http://${config.host}:${config.port}/creator.html?desktop=1`);
}

async function startServerAndOpenWindow() {
  serverApp = require('../src/index');
  await serverApp.start();
  await openMainWindow();
  createTray();
}

function showMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function quitApp() {
  isQuitting = true;
  app.quit();
}

// app.exit() (unlike app.quit()) does not emit 'before-quit'/'will-quit', so
// the server must be shut down explicitly first — otherwise the relaunched
// instance could race the old process for the port/DB file.
async function restartApp() {
  isQuitting = true;
  if (serverApp) {
    try { await serverApp.shutdown(); } catch {}
  }
  app.relaunch();
  app.exit(0);
}

// Electron's login-item API only covers Windows and macOS; on Linux,
// setLoginItemSettings is a no-op and getLoginItemSettings always reports
// false. Freedesktop autostart (an XDG .desktop entry in ~/.config/autostart)
// is the equivalent honored by GNOME, KDE, and the other mainstream desktops,
// so implement the same tray checkbox with that file's existence as the state.
const linuxAutostartFile = path.join(app.getPath('appData'), 'autostart', 'paperweight.desktop');

function getOpenAtLogin() {
  if (process.platform === 'linux') return fs.existsSync(linuxAutostartFile);
  return app.getLoginItemSettings().openAtLogin;
}

function setOpenAtLogin(enabled) {
  if (process.platform !== 'linux') {
    app.setLoginItemSettings({ openAtLogin: enabled });
    return;
  }
  if (!enabled) {
    fs.rmSync(linuxAutostartFile, { force: true });
    return;
  }
  // For AppImage builds process.execPath points inside the extracted mount,
  // which disappears on quit — the APPIMAGE env var carries the real path.
  const execPath = process.env.APPIMAGE || process.execPath;
  fs.mkdirSync(path.dirname(linuxAutostartFile), { recursive: true });
  fs.writeFileSync(linuxAutostartFile, [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Paperweight',
    'Comment=Self-hosted, creator-first streaming and distribution',
    `Exec="${execPath}"`,
    'X-GNOME-Autostart-enabled=true',
    '',
  ].join('\n'));
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: 'Open Dashboard', click: showMainWindow },
    { type: 'separator' },
    {
      label: 'Launch at Login',
      type: 'checkbox',
      checked: getOpenAtLogin(),
      click: item => {
        try {
          setOpenAtLogin(item.checked);
        } catch (err) {
          console.error('[Paperweight] Failed to update Launch at Login:', err);
        }
      },
    },
    { type: 'separator' },
    { label: 'Quit Paperweight', click: quitApp },
  ]);
}

function createTray() {
  if (tray) return;
  const iconPath = path.join(__dirname, 'build', 'tray-icon.png');
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon.isEmpty() ? icon : icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('Paperweight');
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', showMainWindow);
}

// Called by the setup wizard (via IPC) once .env has been provisioned. Runs
// exactly once, on first launch after setup — later ordinary boots go
// through boot()'s other branch and never call this, so folders the creator
// organizes later (outside the explicit "import folder" button) are never
// silently swept into collections behind their back.
function onSetupComplete() {
  startServerAndOpenWindow()
    .then(() => {
      const { adoptExistingVaultFolders } = require('../src/collections/collections');
      // Safe/idempotent against a freshly-created empty vault — fast no-op.
      return adoptExistingVaultFolders().catch(err => {
        console.error('[Paperweight] Folder adoption failed:', err);
      });
    })
    .catch(err => {
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
    openSetupWindow({ dataRoot, onComplete: onSetupComplete, icon: windowIcon });
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', showMainWindow);

  app.whenReady().then(boot);

  // The tray icon keeps the app (and the broadcast) alive after the window is
  // closed on every platform, so window-all-closed should never quit here —
  // only the tray's "Quit Paperweight" / quitApp() does that.
  app.on('window-all-closed', () => {});

  app.on('before-quit', () => {
    isQuitting = true;
    if (serverApp) {
      try { serverApp.shutdown(); } catch {}
    }
  });
}
