'use strict';

// Resolves the cloudflared binary the same way src/runtime/ffmpeg.js resolves
// ffmpeg/ffprobe: bundled inside the pkg executable, staged into Electron's
// extraResources, a repo-local vendor/ directory (plain `node src/index.js`),
// or finally the bare command name on PATH. Used by
// src/runtime/tunnel-supervisor.js to spawn/supervise the tunnel connector so
// the dashboard's "auto-create tunnel" flow never requires the owner to open
// a terminal.

const path = require('path');
const fs   = require('fs');
const { spawnSync } = require('child_process');
const { ensureExtracted } = require('./bundle-extract');

const isPackaged = typeof process.pkg !== 'undefined';
const isElectron = process.env.PAPERWEIGHT_ELECTRON === 'true';

const CLOUDFLARED_BIN = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';

let cloudflaredPath = 'cloudflared';

if (isPackaged) {
  const dataRoot = path.dirname(process.execPath);
  const binDir = path.join(dataRoot, 'bin');
  const dest = path.join(binDir, CLOUDFLARED_BIN);

  try {
    // Same embedding technique as ffmpeg-bundle.js, for the same reason
    // (pkg.assets globs are broken for node20 targets).
    const bundle = require('../cloudflared-bundle');
    const entry = bundle.cloudflared;
    if (!entry) throw new Error('cloudflared-bundle.js is missing cloudflared');
    if (ensureExtracted(entry, dest)) {
      console.log(`[Paperweight] cloudflared ready in ${binDir}`);
    } else {
      throw new Error('extraction did not produce the binary');
    }
  } catch (err) {
    console.warn(`[Paperweight] Could not extract bundled cloudflared: ${err.message}`);
  }

  if (fs.existsSync(dest)) cloudflaredPath = dest;
} else if (isElectron && process.resourcesPath) {
  const electronDest = path.join(process.resourcesPath, 'bin', CLOUDFLARED_BIN);
  if (fs.existsSync(electronDest)) {
    cloudflaredPath = electronDest;
  } else {
    const vendorDest = path.join(__dirname, '../../vendor/cloudflared', CLOUDFLARED_BIN);
    if (fs.existsSync(vendorDest)) cloudflaredPath = vendorDest;
  }
} else {
  const vendorDest = path.join(__dirname, '../../vendor/cloudflared', CLOUDFLARED_BIN);
  if (fs.existsSync(vendorDest)) cloudflaredPath = vendorDest;
}

function commandVersion() {
  try {
    const result = spawnSync(cloudflaredPath, ['--version'], {
      stdio: 'pipe',
      windowsHide: true,
      timeout: 3000,
      encoding: 'utf8',
    });
    if (result.status !== 0) return null;
    return String(result.stdout || '').split(/\r?\n/)[0] || `${cloudflaredPath} found`;
  } catch {
    return null;
  }
}

function isAvailable() {
  return commandVersion() !== null;
}

function installHint() {
  if (isPackaged || isElectron) {
    return 'cloudflared could not be extracted from the bundle. Try reinstalling Paperweight.';
  }
  if (process.platform === 'win32') {
    return 'Install cloudflared with: winget install --id Cloudflare.cloudflared';
  }
  if (process.platform === 'darwin') {
    return 'Install cloudflared with: brew install cloudflared';
  }
  return 'Install cloudflared: https://developers.cloudflare.com/cloudflared/get-started/';
}

module.exports = { cloudflaredPath, commandVersion, isAvailable, installHint };
