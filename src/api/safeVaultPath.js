const path = require('path');
const config = require('../config');

function normalizeCase(filepath) {
  return process.platform === 'win32' ? filepath.toLowerCase() : filepath;
}

function safeVaultPath(filepath) {
  if (!filepath || typeof filepath !== 'string') return null;

  const vaultRoot = path.resolve(config.vault.path);
  const resolved = path.resolve(filepath);
  const root = normalizeCase(vaultRoot);
  const target = normalizeCase(resolved);
  const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;

  if (target === root || target.startsWith(rootWithSep)) {
    return resolved;
  }
  return null;
}

module.exports = { safeVaultPath };
