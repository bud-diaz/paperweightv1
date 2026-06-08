'use strict';
// Extracts better_sqlite3.node from the pkg snapshot to the real filesystem
// so Node can dlopen() it. Only used in packaged mode (process.pkg defined).
//
// Writes next to the exe for persistence (skips extraction if already present).
// Falls back to os.tmpdir() if the exe directory is not writable.

const fs   = require('fs');
const path = require('path');
const os   = require('os');

let cachedPath = null;

function getNativeBindingPath() {
  if (cachedPath) return cachedPath;

  const bundle  = require('./native-bundle');
  const exeDir  = path.dirname(process.execPath);
  const primary = path.join(exeDir, 'better_sqlite3.node');

  if (fs.existsSync(primary)) {
    cachedPath = primary;
    return cachedPath;
  }

  try {
    fs.writeFileSync(primary, bundle);
    cachedPath = primary;
  } catch {
    const tmp = path.join(os.tmpdir(), 'better_sqlite3.node');
    fs.writeFileSync(tmp, bundle);
    cachedPath = tmp;
  }

  return cachedPath;
}

module.exports = getNativeBindingPath;
