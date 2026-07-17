'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const electronBin = path.join(
  ROOT,
  'electron',
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'electron.cmd' : 'electron'
);

if (!fs.existsSync(electronBin)) {
  console.error('[Paperweight desktop dev] Electron is not installed.');
  console.error('[Paperweight desktop dev] Run: npm install --prefix electron');
  process.exit(1);
}

const dataRoot = process.env.PAPERWEIGHT_DATA_ROOT
  ? path.resolve(process.env.PAPERWEIGHT_DATA_ROOT)
  : ROOT;

const child = spawn(electronBin, [path.join(ROOT, 'electron', 'main.js')], {
  cwd: ROOT,
  env: {
    ...process.env,
    NODE_ENV: process.env.NODE_ENV || 'development',
    PAPERWEIGHT_DATA_ROOT: dataRoot,
    PAPERWEIGHT_DEV_RELOAD: process.env.PAPERWEIGHT_DEV_RELOAD || 'true',
  },
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

let shuttingDown = false;

child.on('exit', (code, signal) => {
  if (shuttingDown) return;
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code || 0);
});

function stop(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  if (!child.killed) {
    child.kill(process.platform === 'win32' ? undefined : 'SIGTERM');
  }

  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGUSR2', () => stop('SIGUSR2'));
