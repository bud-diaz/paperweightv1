const chokidar = require('chokidar');
const path = require('path');
const { probe, isSupported } = require('./probe');
const { needsProbe, upsert, markInactive } = require('./sync');
const { log } = require('../db');

let watcherInstance = null;
const pendingFiles = new Map();
const PROBE_DEBOUNCE_MS = 150;

function startWatcher(vaultPath, adapter) {
  if (watcherInstance) {
    log('warn', 'scanner', 'Watcher already running');
    return watcherInstance;
  }

  log('info', 'scanner', `Starting vault watcher: ${vaultPath}`);

  watcherInstance = chokidar.watch(vaultPath, {
    persistent: true,
    followSymlinks: false,
    ignoreInitial: false,
    awaitWriteFinish: {
      stabilityThreshold: 2000,
      pollInterval: 500,
    },
    ignored: /(^|[/\\])\../,  // ignore dotfiles
  });

  watcherInstance
    .on('add', filepath => queueFile(filepath, adapter, 'add'))
    .on('change', filepath => queueFile(filepath, adapter, 'change'))
    .on('unlink', filepath => onRemove(filepath))
    .on('error', err => log('error', 'scanner', `Watcher error: ${err.message}`))
    .on('ready', () => log('info', 'scanner', 'Initial vault scan complete'));

  return watcherInstance;
}

function queueFile(filepath, adapter, event) {
  if (!isSupported(filepath)) return;

  const key = path.resolve(filepath);
  const existing = pendingFiles.get(key);
  if (existing) {
    existing.event = event;
    existing.dirty = true;
    return;
  }

  const job = { event, dirty: false, timer: null };
  pendingFiles.set(key, job);
  job.timer = setTimeout(() => runQueuedFile(key, filepath, adapter, job), PROBE_DEBOUNCE_MS);
}

async function runQueuedFile(key, filepath, adapter, job) {
  job.timer = null;
  try {
    do {
      job.dirty = false;
      await onFile(filepath, adapter, job.event);
    } while (job.dirty);
  } finally {
    if (pendingFiles.get(key) === job) pendingFiles.delete(key);
  }
}

async function onFile(filepath, adapter, event) {
  if (!isSupported(filepath)) return;

  if (event === 'add' && !needsProbe(filepath)) {
    // File exists in DB and hasn't changed — skip re-probe
    return;
  }

  try {
    const probeData = await probe(filepath);
    const category = adapter.getCategory(filepath, probeData);
    upsert(filepath, category, probeData);
    log('info', 'scanner', `Indexed [${category}]: ${path.basename(filepath)}`);
  } catch (err) {
    log('error', 'scanner', `Failed to index ${path.basename(filepath)}: ${err.message}`);
  }
}

function onRemove(filepath) {
  if (!isSupported(filepath)) return;
  markInactive(filepath);
}

function stopWatcher() {
  if (watcherInstance) {
    watcherInstance.close();
    watcherInstance = null;
    for (const job of pendingFiles.values()) {
      if (job.timer) clearTimeout(job.timer);
    }
    pendingFiles.clear();
    log('info', 'scanner', 'Watcher stopped');
  }
}

module.exports = { startWatcher, stopWatcher };
