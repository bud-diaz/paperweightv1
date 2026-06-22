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

// Set by electron/main.js before requiring this module (and src/index.js).
// Electron apps run from a read-only install location on both Windows and
// Mac, so — unlike the pkg .exe case — there is no writable directory next
// to the binary; the Electron main process points this at app.getPath('userData')
// instead and we just read the env var here to keep this file Electron-agnostic.
const isElectron = process.env.PAPERWEIGHT_ELECTRON === 'true';

const appRoot  = path.resolve(__dirname, '..');
const dataRoot = isElectron
  ? (process.env.PAPERWEIGHT_DATA_ROOT || appRoot)
  : isPackaged
    ? path.dirname(process.execPath)
    : appRoot;

function loadPackageVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

// ─── .env loader ─────────────────────────────────────────────────────────────

function parseEnvValue(raw) {
  let value = String(raw || '').trim();
  if (!value) return '';

  const quote = value[0];
  if (quote === '"' || quote === "'") {
    let out = '';
    let escaped = false;
    for (let i = 1; i < value.length; i++) {
      const ch = value[i];
      if (quote === '"' && escaped) {
        out += ch;
        escaped = false;
        continue;
      }
      if (quote === '"' && ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === quote) return out;
      out += ch;
    }
    return out;
  }

  const commentAt = value.search(/\s#/);
  if (commentAt !== -1) value = value.slice(0, commentAt).trim();
  return value;
}

let isFirstRun = false;

function loadEnv() {
  const envPath = path.join(dataRoot, '.env');

  if (!fs.existsSync(envPath)) {
    if (process.env.PAPERWEIGHT_ALLOW_MISSING_ENV === 'true') {
      return;
    }

    if (isElectron) {
      // The Electron main process runs the setup wizard and writes .env via
      // src/setup/provision.js before ever requiring src/index.js, so this
      // branch is defensive only — it should never be hit in practice.
      console.error('ERROR: .env missing in the Electron data root; the setup wizard should have created it.');
      process.exit(1);
    }

    if (isPackaged) {
      // First run: ask one setup question then create a default .env.
      let isRadioHost = false;
      try {
        process.stdout.write('\nAre you a radio host? (y/n): ');
        const buf = Buffer.alloc(4);
        const n = fs.readSync(0, buf, 0, 4);
        const answer = buf.slice(0, n).toString('utf8').trim().toLowerCase();
        isRadioHost = answer === 'y' || answer === 'yes';
        process.stdout.write('\n');
      } catch {
        // Non-interactive (piped stdin, CI, etc.) — default to creator mode
      }

      const token = crypto.randomBytes(16).toString('hex');
      const signingSecret = crypto.randomBytes(32).toString('hex');
      const deviceLock = require('./device-lock').computeFingerprint();
      const defaults = [
        '# Paperweight configuration — edit and restart the exe to apply changes',
        `DASHBOARD_TOKEN=${token}`,
        `DOWNLOAD_SIGNING_SECRET=${signingSecret}`,
        `DEVICE_LOCK=${deviceLock}`,
        'STATION_NAME=My Station',
        'HOST=127.0.0.1',
        'PORT=3000',
        'TRUST_PROXY=false',
        `CREATOR_TYPE=${isRadioHost ? 'radio_host' : 'creator'}`,
        'RADIO_HOST_SWITCHES=0',
        '',
      ].join('\n');
      fs.writeFileSync(envPath, defaults, 'utf8');
      console.log(`[Paperweight] Created default .env at:\n  ${envPath}`);
      console.log(`[Paperweight] Your dashboard token is: ${token}\n`);
      isFirstRun = true;
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
    const val = parseEnvValue(trimmed.slice(eq + 1));
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnv();

const hasEnvValue = key => !!(process.env[key] && process.env[key].trim());

function parseTrustProxy(raw) {
  if (!raw || !String(raw).trim()) return false;
  const value = String(raw).trim();
  const lower = value.toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(lower)) return true;
  if (['false', '0', 'no', 'off'].includes(lower)) return false;
  if (/^\d+$/.test(value)) return parseInt(value, 10);
  return value;
}

// Returns a stable secret for `key`. If it is missing, generate one and persist
// it to .env (when a writable .env exists) so it survives restarts instead of
// changing on every boot — which would silently invalidate dashboard sessions and
// every outstanding signed download link. With no persistent .env
// (PAPERWEIGHT_ALLOW_MISSING_ENV — tests/CI), the value is ephemeral for the
// session only.
function ensurePersistedSecret(key, bytes, label) {
  if (hasEnvValue(key)) return process.env[key];

  const value = crypto.randomBytes(bytes).toString('hex');
  process.env[key] = value;

  const envPath = path.join(dataRoot, '.env');
  if (process.env.PAPERWEIGHT_ALLOW_MISSING_ENV === 'true' || !fs.existsSync(envPath)) {
    return value; // no persistent .env to write to — session-only value
  }
  try {
    const contents = fs.readFileSync(envPath, 'utf8');
    const line = `${key}=${value}`;
    // key is a fixed internal identifier, so this RegExp is not user-controlled.
    const keyRe = new RegExp(`^${key}=.*$`, 'm');
    const next = keyRe.test(contents)
      ? contents.replace(keyRe, line)               // fill an existing empty/placeholder entry
      : contents + (contents.endsWith('\n') ? '' : '\n') + line + '\n';
    fs.writeFileSync(envPath, next, 'utf8');
    console.log(`[Paperweight] Generated ${key} and saved it to .env (${label}). It will persist across restarts.`);
  } catch (err) {
    console.warn(`[Paperweight] Could not persist ${key} to .env (${err.message}); using a temporary value for this session.`);
  }
  return value;
}

// Backfills DEVICE_LOCK into .env for a packaged install whose .env predates
// this feature. Unlike ensurePersistedSecret, the value is computed (not
// random), so it can't reuse that helper's generation logic.
function ensureDeviceLock() {
  if (hasEnvValue('DEVICE_LOCK')) return process.env.DEVICE_LOCK;
  if (!isPackaged) return '';

  const envPath = path.join(dataRoot, '.env');
  if (!fs.existsSync(envPath)) return '';

  const fingerprint = require('./device-lock').computeFingerprint();
  process.env.DEVICE_LOCK = fingerprint;
  try {
    const contents = fs.readFileSync(envPath, 'utf8');
    const line = `DEVICE_LOCK=${fingerprint}`;
    const next = contents + (contents.endsWith('\n') ? '' : '\n') + line + '\n';
    fs.writeFileSync(envPath, next, 'utf8');
    console.log('[Paperweight] Locked this install to this machine (DEVICE_LOCK saved to .env).');
  } catch (err) {
    console.warn(`[Paperweight] Could not persist DEVICE_LOCK (${err.message}).`);
  }
  return fingerprint;
}

const config = {
  version: loadPackageVersion(),

  // True only for the run that just created a default .env (packaged exe,
  // empty install folder). Used to gate one-time first-run setup such as
  // creating a Desktop shortcut.
  isFirstRun,

  host: process.env.HOST || '127.0.0.1',
  port: parseInt(process.env.PORT || '3000', 10),
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),

  station: {
    name:        process.env.STATION_NAME        || 'Paperweight Station',
    identity:    process.env.STATION_IDENTITY    || 'creator',
    creatorType: process.env.CREATOR_TYPE        || 'creator',
    creatorName: process.env.CREATOR_NAME        || '',
    creatorDesc: process.env.CREATOR_DESC        || '',
    slug:        process.env.STATION_SLUG        || '',
    publicUrl:   process.env.STATION_PUBLIC_URL  || '',
  },

  externalSearch: {
    youtubeApiKey:      process.env.YOUTUBE_API_KEY      || '',
    soundcloudClientId: process.env.SOUNDCLOUD_CLIENT_ID || '',
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
      if (hasEnvValue('DASHBOARD_TOKEN')) return process.env.DASHBOARD_TOKEN;
      // Tests/CI run without a .env — leave the dashboard token empty so the gate
      // stays closed rather than minting a usable token nobody knows.
      if (process.env.PAPERWEIGHT_ALLOW_MISSING_ENV === 'true') return '';
      const token = ensurePersistedSecret('DASHBOARD_TOKEN', 16, 'dashboard login');
      console.log(`\n[Paperweight] Your dashboard token is: ${token}\n`);
      return token;
    })(),
    // Separate secret for HMAC-signed download URLs so it never shares entropy
    // with DASHBOARD_TOKEN. Persisted to .env on first run so signed links survive
    // restarts.
    downloadSigningSecret: ensurePersistedSecret('DOWNLOAD_SIGNING_SECRET', 32, 'signed download links'),
  },

  deviceLock: ensureDeviceLock(),

  // Paperweight Cloud (next roadmap phase): native-app deep-link checkout and the
  // multi-station directory. Off by default — the routes guarded by this flag are
  // inert in the self-hosted build.
  cloud: {
    enabled: process.env.PAPERWEIGHT_CLOUD === 'true',
  },

  // true when the server is behind TLS (enables secure cookies, HTTPS redirects)
  https: process.env.HTTPS === 'true',

  // 'desktop' when running inside the Electron app, or when explicitly opted
  // into via DEPLOYMENT_PLATFORM (e.g. a pkg .exe a user wants treated as
  // desktop-equivalent). Defaults to 'web' for plain `npm start`/hosted
  // deployments — see src/auth/platform.js for the features this gates.
  platform: (isElectron || process.env.DEPLOYMENT_PLATFORM === 'desktop') ? 'desktop' : 'web',
};

// Packaged-exe hardware lock: refuse to boot if this .env was set up on a
// different machine. Deters casual copying of the exe + data folder pair —
// not a security boundary, since the check ships inside the user's own pkg
// bundle and can be bypassed by anyone willing to edit DEVICE_LOCK or the code.
if (isPackaged && hasEnvValue('DEVICE_LOCK')) {
  const { computeFingerprint } = require('./device-lock');
  const currentFingerprint = computeFingerprint();
  if (currentFingerprint !== process.env.DEVICE_LOCK) {
    const envPath = path.join(dataRoot, '.env');
    console.error('\n[Paperweight] This installation is locked to a different machine.');
    console.error('[Paperweight] This .env / data folder was set up on another computer and cannot run here.');
    console.error('[Paperweight] If you intentionally moved this install to new hardware, delete the');
    console.error(`[Paperweight] DEVICE_LOCK line from:\n  ${envPath}\n[Paperweight] and restart.\n`);
    process.exit(1);
  }
}

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

module.exports.parseEnvValue = parseEnvValue;
module.exports.parseTrustProxy = parseTrustProxy;
