const path = require('path');

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.mkv', '.avi', '.webm', '.m4v']);
const PODCAST_EXTENSIONS = new Set(['.mp3', '.m4a', '.ogg', '.opus']);
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a', '.aiff', '.opus']);

class MetadataVaultAdapter {
  constructor(vaultPath) {
    this.vaultPath = vaultPath;
  }

  // Determines category from file extension.
  // Video files → 'videos'
  // Audio files → 'music' (podcast distinction requires duration heuristic,
  //   which is post-probe; for pre-probe category assignment we default to 'music'
  //   and let the creator reassign from the dashboard if needed)
  getCategory(filepath, probeData) {
    const ext = path.extname(filepath).toLowerCase();

    if (VIDEO_EXTENSIONS.has(ext)) return 'videos';
    if (AUDIO_EXTENSIONS.has(ext)) {
      // If probe data is available and duration > 20 min, treat as podcast
      if (probeData && probeData.duration && probeData.duration > 1200) {
        return 'podcasts';
      }
      return 'music';
    }
    return 'music';
  }
}

module.exports = MetadataVaultAdapter;
