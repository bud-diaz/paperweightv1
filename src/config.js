const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');

function loadEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) {
    console.error('ERROR: .env file not found. Run scripts/setup.sh first.');
    process.exit(1);
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
    name: process.env.STATION_NAME || 'Paperweight Station',
    identity: process.env.STATION_IDENTITY || 'creator',
    creatorName: process.env.CREATOR_NAME || '',
    creatorDesc: process.env.CREATOR_DESC || '',
    slug: process.env.STATION_SLUG || '',
    publicUrl: process.env.STATION_PUBLIC_URL || '',
  },

  vault: {
    path: path.resolve(ROOT, process.env.VAULT_PATH || './vault'),
    mode: process.env.VAULT_MODE || 'hybrid',
  },

  paths: {
    root: ROOT,
    data: path.resolve(ROOT, process.env.DATA_PATH || './data'),
    hlsOutput: path.resolve(ROOT, process.env.HLS_OUTPUT_PATH || './hls_output'),
    logs: path.resolve(ROOT, process.env.LOG_PATH || './logs'),
  },

  auth: {
    dashboardToken: process.env.DASHBOARD_TOKEN || '',
  },
};

module.exports = config;
