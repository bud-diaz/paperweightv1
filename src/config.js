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

function loadPackageVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

// ─── .env loader ─────────────────────────────────────────────────────────────

function loadEnv() {
  const envPath = path.join(dataRoot, '.env');

  if (!fs.existsSync(envPath)) {
    if (process.env.PAPERWEIGHT_ALLOW_MISSING_ENV === 'true') {
      return;
    }

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

const hasEnvValue = key => !!(process.env[key] && process.env[key].trim());

const config = {
  version: loadPackageVersion(),

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
      if (process.env.PAPERWEIGHT_ALLOW_MISSING_ENV === 'true') return '';
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

  // Paperweight Cloud (next roadmap phase): native-app deep-link checkout and the
  // multi-station directory. Off by default — the routes guarded by this flag are
  // inert in the self-hosted build. See ROADMAP.md.
  cloud: {
    enabled: process.env.PAPERWEIGHT_CLOUD === 'true',
  },

  // true when the server is behind TLS (enables secure cookies, HTTPS redirects)
  https: process.env.HTTPS === 'true',
};

module.exports = config;

function warnStartupConfig() {
  const warnings = [];

  if (!hasEnvValue('DOWNLOAD_SIGNING_SECRET')) {
    warnings.push('DOWNLOAD_SIGNING_SECRET is not set; signed download links will be invalid after restart.');
  }

  if (config.station.publicUrl && !config.https) {
    warnings.push('STATION_PUBLIC_URL is set while HTTPS=false; public listener cookies will not use the Secure flag.');
  }

  const stripeKeys = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_SUBSCRIBER', 'STRIPE_PRICE_PRO', 'STRIPE_PRICE_ALL_ACCESS'];
  const stripeAny = stripeKeys.some(hasEnvValue);
  if (stripeAny && !hasEnvValue('STRIPE_WEBHOOK_SECRET')) {
    warnings.push('Stripe is partially configured without STRIPE_WEBHOOK_SECRET; subscription state will not be authoritative.');
  }

  const paypalKeys = ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_WEBHOOK_ID', 'PAYPAL_PLAN_PRO', 'PAYPAL_PLAN_ALL_ACCESS'];
  const paypalAny = paypalKeys.some(hasEnvValue);
  const paypalRequired = ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_WEBHOOK_ID'];
  if (paypalAny && paypalRequired.some(key => !hasEnvValue(key))) {
    warnings.push('PayPal is partially configured; PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, and PAYPAL_WEBHOOK_ID are all required.');
  }

  for (const warning of warnings) {
    console.warn(`[Paperweight config] WARN ${warning}`);
  }
}

warnStartupConfig();
