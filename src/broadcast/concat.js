const fs = require('fs');
const path = require('path');
const config = require('../config');

const CONCAT_DIR = path.join(config.paths.hlsOutput, 'work');
const CONCAT_PATH = path.join(CONCAT_DIR, 'concat.txt');

// Escapes a file path for use in an ffconcat manifest.
// Single quotes are the only character that needs escaping in this format.
function escapePath(p) {
  return p.replace(/\\/g, '/').replace(/'/g, "'\\''");
}

function writeConcatManifest(tracks) {
  fs.mkdirSync(CONCAT_DIR, { recursive: true });
  const lines = ['ffconcat version 1.0'];

  for (const track of tracks) {
    lines.push(`file '${escapePath(track.filepath)}'`);
    if (track.duration) {
      lines.push(`duration ${track.duration.toFixed(6)}`);
    }
  }

  fs.writeFileSync(CONCAT_PATH, lines.join('\n') + '\n', 'utf8');
  return CONCAT_PATH;
}

module.exports = { writeConcatManifest, CONCAT_PATH, CONCAT_DIR };
