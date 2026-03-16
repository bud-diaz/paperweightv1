const config = require('../config');
const { log } = require('../db');
const { startWatcher, stopWatcher } = require('./watcher');

const FolderVaultAdapter = require('./adapters/folder');
const MetadataVaultAdapter = require('./adapters/metadata');
const HybridVaultAdapter = require('./adapters/hybrid');

function loadAdapter(mode, vaultPath) {
  switch (mode) {
    case 'folder':   return new FolderVaultAdapter(vaultPath);
    case 'metadata': return new MetadataVaultAdapter(vaultPath);
    case 'hybrid':
    default:         return new HybridVaultAdapter(vaultPath);
  }
}

function startScanner() {
  const { path: vaultPath, mode } = config.vault;
  log('info', 'scanner', `Vault mode: ${mode}`);

  const adapter = loadAdapter(mode, vaultPath);
  startWatcher(vaultPath, adapter);
}

module.exports = { startScanner, stopScanner: stopWatcher };
