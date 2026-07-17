'use strict';

// Desktop-only "check for updates" — compares the running app's version
// against the latest GitHub Release tag and, if newer, hands back the
// release page URL for the caller to open. No silent download/install: the
// app isn't code-signed/notarized yet, so a silent auto-installer would be
// unreliable on macOS (Gatekeeper) — see CLAUDE.md. Pure Node (`https`
// built-in), no new dependency.

const https = require('https');

const GITHUB_REPO = 'bud-diaz/paper-packs';

function parseVersion(v) {
  return String(v || '')
    .replace(/^v/i, '')
    .split('.')
    .map(n => parseInt(n, 10) || 0);
}

// Returns 1 if a > b, -1 if a < b, 0 if equal.
function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na !== nb) return na > nb ? 1 : -1;
  }
  return 0;
}

function fetchLatestRelease() {
  return new Promise((resolve, reject) => {
    const req = https.get(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
      {
        headers: {
          'User-Agent': 'Paperweight-Desktop',
          Accept: 'application/vnd.github+json',
        },
      },
      res => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`GitHub returned ${res.statusCode}`));
          return;
        }
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (err) {
            reject(new Error('Failed to parse GitHub release response'));
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(10000, () => req.destroy(new Error('GitHub request timed out')));
  });
}

// @param {string} currentVersion
// @returns {Promise<{ updateAvailable: boolean, latestVersion: string, releaseUrl: string } | { error: string }>}
async function checkForUpdates(currentVersion) {
  try {
    const release = await fetchLatestRelease();
    const latestVersion = String(release.tag_name || '').replace(/^v/i, '');
    if (!latestVersion) throw new Error('Release response missing tag_name');
    return {
      updateAvailable: compareVersions(latestVersion, currentVersion) > 0,
      latestVersion,
      releaseUrl: release.html_url || `https://github.com/${GITHUB_REPO}/releases/latest`,
    };
  } catch (err) {
    return { error: err.message };
  }
}

module.exports = { GITHUB_REPO, checkForUpdates, compareVersions };
