const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// ─── Root paths ──────────────────────────────────────────────────────────────
//
// When running as a packaged .exe (process.pkg is defined by @yao-pkg/pkg):
//   - appRoot  → the virtual snapshot inside the exe (read-only, for client/)
//   - dataRoot → directory containing the .exe (writable, for .env / vault / data)
//
// When running normally with `node src/index.js`:
//   - both point to the project root

const isPackaged = typeof process.pkg !== 'undefined';

const appRoot  = path.resolve(__dirname, '..');
const dataRoot = isPackaged ? path.dirname(process.execPath) : appRoot;

// ─── .env loader ─────────────────────────────────────────────────────────────

function loadEnv() {
  const envPath = path.join(dataRoot, '.env');

  if (!fs.existsSync(envPath)) {
    if (isPackaged) {
      // First run: create a default .env next to the exe so the user can edit it.
      const token = crypto.randomBytes(16).toString('hex');
      const defaults = [
        '# Paperweight configuration — edit and restart the exe to apply changes',
        `DASHBOARD_TOKEN=${token}`,
        'STATION_NAME=My Station',
        'PORT=3000',
        '',
      ].join('\n');
      fs.writeFileSync(envPath, defaults, 'utf8');
      console.log(`[Paperweight] Created default .env at:\n  ${envPath}`);
      console.log(`[Paperweight] Your dashboard token is: ${token}\n`);
    } else {
      console.error('ERROR: .env file not found. Run scripts/setup.sh first.');
      process.exit(1);
    }
  }

  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    // Strip inline comments and surrounding quotes
    let val = trimmed.slice(eq + 1).trim().replace(/#.*$/, '').trim();
    val = val.replace(/^['"]|['"]$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnv();

const config = {
  port: parseInt(process.env.PORT || '3000', 10),

  station: {
    name:        process.env.STATION_NAME        || 'Paperweight Station',
    identity:    process.env.STATION_IDENTITY    || 'creator',
    creatorName: process.env.CREATOR_NAME        || '',
    creatorDesc: process.env.CREATOR_DESC        || '',
    slug:        process.env.STATION_SLUG        || '',
    publicUrl:   process.env.STATION_PUBLIC_URL  || '',
  },

  vault: {
    path: path.resolve(dataRoot, process.env.VAULT_PATH || './vault'),
    mode: process.env.VAULT_MODE || 'hybrid',
  },

  paths: {
    // appRoot is where bundled static files live (client/, src/).
    // Use this anywhere you need to read files baked into the exe.
    app: appRoot,

    // dataRoot is next to the .exe (or the project root in dev).
    // Use this for any writable or user-configurable paths.
    root: dataRoot,

    data:      path.resolve(dataRoot, process.env.DATA_PATH       || './data'),
    hlsOutput: path.resolve(dataRoot, process.env.HLS_OUTPUT_PATH || './hls_output'),
    logs:      path.resolve(dataRoot, process.env.LOG_PATH        || './logs'),
  },

  auth: {
    dashboardToken: (() => {
      if (process.env.DASHBOARD_TOKEN) return process.env.DASHBOARD_TOKEN;
      const generated = crypto.randomBytes(16).toString('hex');
      console.log('\n[Paperweight] DASHBOARD_TOKEN not set — using temporary token for this session:');
      console.log(`  ${generated}`);
      console.log('  Add DASHBOARD_TOKEN=<value> to your .env to make it permanent.\n');
      return generated;
    })(),
    // Separate secret for HMAC-signed download URLs. Falls back to a random
    // value generated at startup so it never shares entropy with DASHBOARD_TOKEN.
    // Set DOWNLOAD_SIGNING_SECRET in .env to make signed URLs survive restarts.
    downloadSigningSecret: process.env.DOWNLOAD_SIGNING_SECRET || crypto.randomBytes(32).toString('hex'),
  },

  // true when the server is behind TLS (enables secure cookies, HTTPS redirects)
  https: process.env.HTTPS === 'true',
};

module.exports = config;
