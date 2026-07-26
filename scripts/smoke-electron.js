#!/usr/bin/env node
// Clean-install smoke test for a BUILT Electron desktop installer.
//
// Pre-seeds a .env at the OS-standard userData path Electron's main.js resolves
// on a packaged build (see resolveDataRoot() in electron/main.js — a packaged
// app always uses app.getPath('userData'), ignoring PAPERWEIGHT_DATA_ROOT), so
// the app boots straight into the server instead of showing the first-run
// setup wizard. Then launches the installed app, waits for /api/health, and
// runs the shared HTTP smoke (scripts/smoke.js) against it.
//
// Usage: node scripts/smoke-electron.js <path-to-installed-executable> [extra launch args...]
//
// The install/extract step (NSIS silent install, DMG/zip extraction, AppImage
// extraction) is OS-specific and handled by the calling CI workflow step —
// this script only needs a launchable executable path. Any extra CLI args
// (e.g. Linux's --appimage-extract-and-run, to avoid a FUSE dependency) are
// forwarded to the spawned process ahead of the standard Electron flags.

'use strict';

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PRODUCT_NAME } = require('../electron/product');

const PORT = parseInt(process.env.PAPERWEIGHT_SMOKE_PORT || '3971', 10);
const BOOT_TIMEOUT_MS = parseInt(process.env.PAPERWEIGHT_SMOKE_BOOT_MS || '60000', 10);
const ROOT = path.resolve(__dirname, '..');

const exePath = process.argv[2];
if (!exePath || !fs.existsSync(exePath)) {
  console.error(`ERROR: installed executable not found: ${exePath || '(none given)'}`);
  console.error('Usage: node scripts/smoke-electron.js <path-to-installed-executable>');
  process.exit(1);
}

function electronUserDataRoot() {
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), PRODUCT_NAME);
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', PRODUCT_NAME);
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), PRODUCT_NAME);
}

const dataRoot = electronUserDataRoot();

console.log(`Clean-install Electron smoke for ${path.basename(exePath)}`);
console.log(`  data root: ${dataRoot}`);
console.log(`  port:      ${PORT}\n`);

// Same minimal CI env template used by the pkg-exe smoke job in
// .github/workflows/build-executables.yml, adapted to this run's port.
fs.mkdirSync(dataRoot, { recursive: true });
fs.writeFileSync(path.join(dataRoot, '.env'), [
  'STATION_NAME=Paperweight Electron CI',
  'STATION_IDENTITY=creator',
  `PORT=${PORT}`,
  'HOST=127.0.0.1',
  'VAULT_PATH=./vault',
  'VAULT_MODE=hybrid',
  'DASHBOARD_TOKEN=ci-electron-dashboard-token-change-me',
  'DOWNLOAD_SIGNING_SECRET=ci-electron-download-secret-change-me',
  'HTTPS=false',
  'DATA_PATH=./data',
  'HLS_OUTPUT_PATH=./hls_output',
  'LOG_PATH=./logs',
  '',
].join('\n'), 'utf8');

const extraArgs = process.argv.slice(3);
const child = spawn(exePath, [...extraArgs, '--no-sandbox', '--disable-gpu'], {
  env: process.env,
  stdio: ['ignore', 'inherit', 'inherit'],
  detached: process.platform !== 'win32',
});

let killed = false;
function killTree() {
  if (killed) return;
  killed = true;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      process.kill(-child.pid, 'SIGKILL'); // whole process group (Electron main + renderer/GPU helpers)
    }
  } catch { /* already gone */ }
}
process.on('exit', killTree);
process.on('SIGINT', () => { killTree(); process.exit(130); });

function httpStatus(pathname) {
  return new Promise(resolve => {
    const req = require('http').get(
      { host: '127.0.0.1', port: PORT, path: pathname, timeout: 3000 },
      res => { res.resume(); resolve(res.statusCode); }
    );
    req.on('timeout', () => { req.destroy(); resolve(0); });
    req.on('error', () => resolve(0));
  });
}

async function waitForBoot() {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`app exited early (code ${child.exitCode})`);
    if ((await httpStatus('/api/health')) === 200) return;
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error(`app did not serve /api/health within ${BOOT_TIMEOUT_MS}ms`);
}

(async () => {
  let ok = true;
  try {
    await waitForBoot();
    console.log('OK   Electron app booted and is serving\n');

    const smoke = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'smoke.js'), `http://127.0.0.1:${PORT}`], { stdio: 'inherit' });
    if (smoke.status !== 0) ok = false;
  } catch (err) {
    console.error(`\nElectron smoke crashed: ${err.message}`);
    ok = false;
  } finally {
    killTree();
    try { fs.rmSync(dataRoot, { recursive: true, force: true }); } catch { /* best effort */ }
  }

  if (!ok) { console.log('\nElectron smoke FAILED.'); process.exit(1); }
  console.log('\nElectron smoke passed.');
  process.exit(0);
})();
