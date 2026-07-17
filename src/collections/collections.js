'use strict';

// Turns a folder of media files into a `vault_projects` "collection" — either
// a single folder the creator explicitly imports at runtime (importFolder),
// or every pre-existing folder discovered inside a vault the creator pointed
// setup at (adoptExistingVaultFolders). Both funnel through the same core
// (registerCollectionFromFolder), which probes and upserts files directly
// via the same pipeline the live scanner watcher uses (src/scanner/watcher.js
// onFile), rather than racing chokidar's async debounce — upsert() is keyed
// on the filepath UNIQUE constraint, so it's harmless if the watcher later
// re-observes the same files.

const fs = require('fs');
const path = require('path');
const config = require('../config');
const { getDb, log } = require('../db');
const { probe, isSupported } = require('../scanner/probe');
const { upsert } = require('../scanner/sync');
const { loadAdapter } = require('../scanner/index');

const VALID_CATEGORIES = new Set([
  'music', 'beats', 'podcasts', 'videos', 'drafts', 'live_sessions',
]);

function walkFiles(dir) {
  let results = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results = results.concat(walkFiles(full));
    else if (entry.isFile()) results.push(full);
  }
  return results;
}

function sanitizeName(name) {
  const cleaned = String(name || '')
    .replace(/[/\\:*?"<>|]/g, '_')
    .trim()
    .replace(/^\.+|\.+$/g, '');
  return cleaned.slice(0, 200) || 'import';
}

// Recursively probes + upserts every supported file under folderPath, then
// finds-or-creates a vault_projects row named after folderPath's basename
// and links the resulting media rows into it.
async function registerCollectionFromFolder(folderPath) {
  const name = path.basename(folderPath);
  const files = walkFiles(folderPath).filter(isSupported);

  if (files.length === 0) {
    return { ok: true, skipped: true, name, trackCount: 0 };
  }

  const db = getDb();
  const adapter = loadAdapter(config.vault.mode, config.vault.path);
  const mediaIds = [];

  for (const file of files) {
    try {
      const probeData = await probe(file);
      const category = adapter.getCategory(file, probeData);
      upsert(file, category, probeData);
      const row = db.prepare('SELECT id FROM media WHERE filepath = ?').get(path.resolve(file));
      if (row) mediaIds.push(row.id);
    } catch (err) {
      log('error', 'vault', `Failed to index ${path.basename(file)} while importing folder "${name}": ${err.message}`);
    }
  }

  if (mediaIds.length === 0) {
    return { ok: true, skipped: true, name, trackCount: 0 };
  }

  let project = db.prepare('SELECT id FROM vault_projects WHERE name = ?').get(name);
  let projectId;
  if (project) {
    projectId = project.id;
  } else {
    const info = db.prepare('INSERT INTO vault_projects (name, allow_free) VALUES (?, 1)').run(name);
    projectId = info.lastInsertRowid;
    log('info', 'vault', `Collection created from folder import: ${name} (id=${projectId})`);
  }

  const linkItem = db.prepare(
    'INSERT INTO vault_project_items (project_id, content_id, sort_order) VALUES (?, ?, ?)'
  );
  let sortOrder = 0;
  for (const id of mediaIds) {
    try {
      linkItem.run(projectId, id, sortOrder++);
    } catch (err) {
      if (!err.message.includes('UNIQUE constraint failed')) throw err;
      // Already linked to a project (this one or another) — leave it as-is.
    }
  }

  return { ok: true, projectId, name, trackCount: mediaIds.length };
}

function cpFilter(src) {
  if (path.basename(src).startsWith('.')) return false;
  try {
    if (fs.statSync(src).isDirectory()) return true;
  } catch {
    return false;
  }
  return isSupported(src);
}

// Copies an externally-picked folder into vault/imports/<name>/ and registers
// it as a collection. Lands under `imports/` (not one of the 6 recognized
// category names) so the hybrid/metadata adapters correctly categorize each
// file individually instead of force-categorizing everything as "music".
async function importFolder(sourcePath) {
  const safeName = sanitizeName(path.basename(sourcePath));
  const destDir = path.join(config.vault.path, 'imports', safeName);
  fs.mkdirSync(destDir, { recursive: true });
  fs.cpSync(sourcePath, destDir, { recursive: true, filter: cpFilter });
  return registerCollectionFromFolder(destDir);
}

// Finds the folders inside a vault tree that should become collections: the
// vault root itself, and any of the 6 recognized category folders directly
// under it, are treated as transparent containers to recurse through. The
// first genuinely creator-named folder found at any point becomes one
// collection root, claiming everything nested beneath it (files and further
// subfolders alike) — mirroring "one picked folder = one collection".
function findCollectionRoots(dir, vaultPath) {
  const isContainer = dir === vaultPath
    || (VALID_CATEGORIES.has(path.basename(dir)) && path.dirname(dir) === vaultPath);

  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  if (!isContainer) {
    return [dir];
  }

  const roots = [];
  for (const entry of entries) {
    if (entry.isDirectory() && !entry.name.startsWith('.')) {
      roots.push(...findCollectionRoots(path.join(dir, entry.name), vaultPath));
    }
  }
  return roots;
}

// Run once, right after first-run setup completes (see electron/main.js
// onSetupComplete) — adopts any folders already present in a vault the
// creator pointed setup at. Safe/idempotent to call against an empty,
// freshly-provisioned vault: findCollectionRoots finds nothing and this is a
// fast no-op.
async function adoptExistingVaultFolders() {
  const vaultPath = config.vault.path;
  const roots = findCollectionRoots(vaultPath, vaultPath);
  const results = [];
  for (const root of roots) {
    try {
      results.push(await registerCollectionFromFolder(root));
    } catch (err) {
      log('error', 'vault', `Failed to adopt folder as collection: ${root}: ${err.message}`);
    }
  }
  return results;
}

module.exports = { registerCollectionFromFolder, importFolder, findCollectionRoots, adoptExistingVaultFolders };
