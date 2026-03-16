const path = require('path');

const VALID_CATEGORIES = new Set([
  'music', 'beats', 'podcasts', 'videos', 'drafts', 'live_sessions',
]);

class FolderVaultAdapter {
  constructor(vaultPath) {
    this.vaultPath = vaultPath;
  }

  // Returns the top-level vault subdirectory as the category.
  // Files dropped directly in vault/ root fall back to 'music'.
  getCategory(filepath) {
    const rel = path.relative(this.vaultPath, filepath);
    const top = rel.split(path.sep)[0];
    return VALID_CATEGORIES.has(top) ? top : 'music';
  }
}

module.exports = FolderVaultAdapter;
