'use strict';

// Desktop "uninstall" flow: export data to a fresh Desktop folder, shut the
// server down cleanly, wipe the app's own data/config, then quit. The
// installed program files themselves are left for the user's normal OS
// uninstall (Add/Remove Programs, drag-to-trash, apt remove) — this module
// never attempts to invoke a platform uninstaller.
//
// Kept Electron-agnostic (no `require('electron')`) like the rest of `src/`:
// the caller (electron/ipc/app-handlers.js) supplies `desktopPath` and
// `autostartFile`, which only Electron's `app.getPath()` can resolve.

const fs = require('fs');
const path = require('path');
const { getDb } = require('../db');
const {
  getSubscriberRows, getListenerRows, getDownloadLeadRows,
  SUBSCRIBER_HEADERS, LISTENER_HEADERS, DOWNLOAD_LEAD_HEADERS,
  toCsvString,
} = require('../export/exports');

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
}

// Never overwrite a prior export — append -2, -3, ... on collision.
function uniqueExportDir(desktopPath) {
  const base = path.join(desktopPath, `Paperweight Export ${timestamp()}`);
  let dest = base;
  let n = 2;
  while (fs.existsSync(dest)) {
    dest = `${base}-${n}`;
    n++;
  }
  return dest;
}

function copyIfExists(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.cpSync(src, dest, { recursive: true });
}

function countFilesRecursive(dir) {
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    count += entry.isDirectory() ? countFilesRecursive(full) : 1;
  }
  return count;
}

async function exportData({ config, desktopPath }) {
  const dest = uniqueExportDir(desktopPath);
  fs.mkdirSync(dest, { recursive: true });

  const db = getDb();
  fs.writeFileSync(path.join(dest, 'subscribers.csv'), toCsvString(SUBSCRIBER_HEADERS, getSubscriberRows(db)));
  fs.writeFileSync(path.join(dest, 'listeners.csv'), toCsvString(LISTENER_HEADERS, getListenerRows(db)));
  fs.writeFileSync(path.join(dest, 'download-leads.csv'), toCsvString(DOWNLOAD_LEAD_HEADERS, getDownloadLeadRows(db)));
  await db.backup(path.join(dest, 'paperweight-backup.db'));

  copyIfExists(config.vault.path, path.join(dest, 'vault'));
  copyIfExists(path.join(config.paths.root, '.env'), path.join(dest, '.env'));
  copyIfExists(config.paths.logs, path.join(dest, 'logs'));
  // hls_output/ (transient, regenerable stream segments) and data/upload_tmp/
  // (scratch space) are deliberately excluded from the export.

  if (countFilesRecursive(dest) === 0) {
    throw new Error('Export produced no files — aborting before deleting anything.');
  }

  return dest;
}

function wipeDataRoot({ config, autostartFile }) {
  // Delete known contents of the data root individually rather than the
  // userData directory as a whole — safer while Electron still considers it
  // its own root.
  fs.rmSync(config.paths.data, { recursive: true, force: true });
  fs.rmSync(config.vault.path, { recursive: true, force: true });
  fs.rmSync(config.paths.logs, { recursive: true, force: true });
  fs.rmSync(config.paths.hlsOutput, { recursive: true, force: true });
  fs.rmSync(path.join(config.paths.root, '.env'), { force: true });
  if (autostartFile) fs.rmSync(autostartFile, { force: true });
}

// @param {{ serverApp, config, quit: () => void, desktopPath: string, autostartFile: string }} deps
async function runUninstall({ serverApp, config, quit, desktopPath, autostartFile }) {
  const exportDir = await exportData({ config, desktopPath });
  await serverApp.shutdown();
  wipeDataRoot({ config, autostartFile });
  quit();
  return { ok: true, exportDir };
}

module.exports = { runUninstall };
