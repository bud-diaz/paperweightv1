'use strict';

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { ensureExtracted } = require('./bundle-extract');

const isPackaged = typeof process.pkg !== 'undefined';
const isElectron = process.env.PAPERWEIGHT_ELECTRON === 'true';
const FRPC_BIN = process.platform === 'win32' ? 'frpc.exe' : 'frpc';

let frpcPath = 'frpc';

if (isPackaged) {
  const dataRoot = path.dirname(process.execPath);
  const binDir = path.join(dataRoot, 'bin');
  const dest = path.join(binDir, FRPC_BIN);
  try {
    const bundle = require('../frp-bundle');
    const entry = bundle.frpc;
    if (!entry) throw new Error('frp-bundle.js is missing frpc');
    ensureExtracted(entry, dest);
  } catch (err) {
    console.warn(`[Paperweight] Could not extract bundled frpc: ${err.message}`);
  }
  if (fs.existsSync(dest)) frpcPath = dest;
} else if (isElectron && process.resourcesPath) {
  const electronDest = path.join(process.resourcesPath, 'bin', FRPC_BIN);
  if (fs.existsSync(electronDest)) {
    frpcPath = electronDest;
  } else {
    const vendorDest = path.join(__dirname, '../../vendor/frp', FRPC_BIN);
    if (fs.existsSync(vendorDest)) frpcPath = vendorDest;
  }
} else {
  const vendorDest = path.join(__dirname, '../../vendor/frp', FRPC_BIN);
  if (fs.existsSync(vendorDest)) frpcPath = vendorDest;
}

function commandVersion() {
  try {
    const result = spawnSync(frpcPath, ['--version'], {
      stdio: 'pipe',
      windowsHide: true,
      timeout: 3000,
      encoding: 'utf8',
    });
    if (result.status !== 0) return null;
    return String(result.stdout || result.stderr || '').split(/\r?\n/)[0] || `${frpcPath} found`;
  } catch {
    return null;
  }
}

function isAvailable() {
  return commandVersion() !== null;
}

function installHint() {
  if (isPackaged || isElectron) {
    return 'frpc could not be extracted from the Paperweight bundle. Try reinstalling Paperweight.';
  }
  return 'Install frp/frpc from https://github.com/fatedier/frp/releases or use a Paperweight desktop build that bundles it.';
}

module.exports = { frpcPath, commandVersion, isAvailable, installHint };
