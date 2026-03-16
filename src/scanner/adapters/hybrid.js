const path = require('path');
const FolderVaultAdapter = require('./folder');
const MetadataVaultAdapter = require('./metadata');

const VALID_CATEGORIES = new Set([
  'music', 'beats', 'podcasts', 'videos', 'drafts', 'live_sessions',
]);

// HybridVaultAdapter: top-level folder defines the category when it matches a
// known vault category. If the file is outside a recognised folder (e.g. dumped
// straight into vault root, or nested under a custom folder name), fall back to
// metadata-based detection.
class HybridVaultAdapter {
  constructor(vaultPath) {
    this.vaultPath = vaultPath;
    this._folder = new FolderVaultAdapter(vaultPath);
    this._metadata = new MetadataVaultAdapter(vaultPath);
  }

  getCategory(filepath, probeData) {
    const rel = path.relative(this.vaultPath, filepath);
    const top = rel.split(path.sep)[0];

    if (VALID_CATEGORIES.has(top)) {
      return top;
    }

    // Top folder is not a recognised category — fall back to metadata detection
    return this._metadata.getCategory(filepath, probeData);
  }
}

module.exports = HybridVaultAdapter;
