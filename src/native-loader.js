'use strict';
// Extracts better_sqlite3.node from the pkg snapshot to the real filesystem
// so Node can dlopen() it. Only used in packaged mode (process.pkg defined).
//
// Existing files are used only when they match the embedded SHA-256. This avoids
// stale bindings after upgrades and prevents loading planted native libraries.

const fs     = require('fs');
const path   = require('path');
const os     = require('os');
const crypto = require('crypto');

let cachedPath = null;

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function readBundle() {
  const mod = require('./native-bundle');
  if (mod.platform !== process.platform) {
    throw new Error(
      `native-bundle.js platform mismatch: bundle=${mod.platform || 'unknown'} runtime=${process.platform}`,
    );
  }
  if (mod.arch !== process.arch) {
    throw new Error(
      `native-bundle.js architecture mismatch: bundle=${mod.arch || 'unknown'} runtime=${process.arch}`,
    );
  }
  if (mod.moduleAbi !== process.versions.modules) {
    throw new Error(
      `native-bundle.js Node ABI mismatch: bundle=${mod.moduleAbi || 'unknown'} runtime=${process.versions.modules}. ` +
      'Regenerate the native bundle with the same Node runtime used by the packaged executable.',
    );
  }
  const data = Buffer.isBuffer(mod) ? mod : mod.data;
  if (!Buffer.isBuffer(data)) {
    throw new Error('native-bundle.js did not export a native binding buffer');
  }
  if (mod.abi && mod.abi !== process.versions.modules) {
    throw new Error(
      `native binding ABI mismatch: bundled for ABI ${mod.abi}, ` +
      `running under ABI ${process.versions.modules}. ` +
      'Rebuild the executable under the matching Node version (node20 for pkg target node20-*).'
    );
  }
  const expectedHash = mod.sha256 || sha256(data);
  return { data, expectedHash };
}

function fileMatches(filepath, expectedHash) {
  try {
    return fs.existsSync(filepath) && sha256(fs.readFileSync(filepath)) === expectedHash;
  } catch {
    return false;
  }
}

function writeVerified(filepath, data, expectedHash) {
  fs.mkdirSync(path.dirname(filepath), { recursive: true, mode: 0o700 });
  if (!fileMatches(filepath, expectedHash)) {
    fs.writeFileSync(filepath, data, { mode: 0o600 });
  }
  if (!fileMatches(filepath, expectedHash)) {
    throw new Error(`native binding hash verification failed: ${filepath}`);
  }
  return filepath;
}

function fallbackPath(expectedHash) {
  let userPart = 'user';
  try {
    userPart = typeof process.getuid === 'function' ? process.getuid() : os.userInfo().username;
  } catch {}
  userPart = String(userPart).replace(/[^a-zA-Z0-9_.-]/g, '_');
  return path.join(
    os.tmpdir(),
    `paperweight-native-${userPart}-${expectedHash.slice(0, 16)}`,
    'better_sqlite3.node',
  );
}

function getNativeBindingPath() {
  if (cachedPath) return cachedPath;

  const { data, expectedHash } = readBundle();
  const exeDir = path.dirname(process.execPath);
  const primary = path.join(exeDir, 'better_sqlite3.node');

  try {
    cachedPath = writeVerified(primary, data, expectedHash);
    return cachedPath;
  } catch {}

  cachedPath = writeVerified(fallbackPath(expectedHash), data, expectedHash);
  return cachedPath;
}

module.exports = getNativeBindingPath;
