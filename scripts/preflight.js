#!/usr/bin/env node
// Preflight check - run before first launch, packaging, or release.

const { spawnSync } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let ok = true;

function pass(msg) { console.log(`  OK   ${msg}`); }
function fail(msg) { console.log(`  FAIL ${msg}`); ok = false; }
function warn(msg) { console.log(`  WARN ${msg}`); }
function section(name) { console.log(`\n-- ${name} ${'-'.repeat(Math.max(1, 54 - name.length))}`); }

function readEnvFile() {
  const envPath = path.join(ROOT, '.env');
  const env = {};
  if (!fs.existsSync(envPath)) return { env, exists: false };

  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim().replace(/#.*$/, '').trim();
    value = value.replace(/^['"]|['"]$/g, '');
    env[key] = value;
  }

  return { env, exists: true };
}

function commandVersion(name) {
  const result = spawnSync(name, ['-version'], { stdio: 'pipe' });
  if (result.status !== 0) return null;
  return result.stdout.toString().split(/\r?\n/)[0].trim();
}

function installHintFor(bin) {
  if (process.platform === 'win32') {
    return `${bin} not found - install FFmpeg with winget install Gyan.FFmpeg, then reopen your terminal`;
  }
  if (process.platform === 'darwin') {
    return `${bin} not found - install FFmpeg with brew install ffmpeg`;
  }
  return `${bin} not found - install FFmpeg with sudo apt install ffmpeg`;
}

function ensureDir(abs, label) {
  try {
    fs.mkdirSync(abs, { recursive: true });
    pass(`${label} exists or was created`);
  } catch (err) {
    fail(`${label} could not be created: ${err.message}`);
  }
}

function checkPort(port) {
  return new Promise(resolve => {
    const server = net.createServer();
    server.once('error', err => {
      if (err.code === 'EADDRINUSE') {
        fail(`Port ${port} is already in use`);
      } else {
        warn(`Could not check port ${port}: ${err.message}`);
      }
      resolve();
    });
    server.once('listening', () => {
      server.close(() => {
        pass(`Port ${port} is available`);
        resolve();
      });
    });
    server.listen(port, '127.0.0.1');
  });
}

function hasAny(env, keys) {
  return keys.some(key => env[key] && env[key].trim());
}

async function main() {
  const { env, exists: hasEnv } = readEnvFile();

  section('Node.js');
  const [major] = process.versions.node.split('.').map(Number);
  if (major >= 18) pass(`Node.js ${process.version}`);
  else fail(`Node.js ${process.version} - v18+ required`);

  section('.env');
  if (!hasEnv) {
    fail('.env not found - run: bash scripts/setup.sh');
  } else {
    pass('.env file found');
    if (env.DASHBOARD_TOKEN) pass('DASHBOARD_TOKEN is set');
    else fail('DASHBOARD_TOKEN is missing');

    if (!env.STATION_NAME || env.STATION_NAME === 'My Station') {
      warn('STATION_NAME looks unset or default');
    } else {
      pass(`STATION_NAME: ${env.STATION_NAME}`);
    }

    if (env.STATION_SLUG) pass(`STATION_SLUG: ${env.STATION_SLUG}`);
    else warn('STATION_SLUG not set');
  }

  section('npm dependencies');
  const packagePath = path.join(ROOT, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const nodeModules = path.join(ROOT, 'node_modules');
  if (!fs.existsSync(nodeModules)) {
    fail('node_modules missing - run: npm install');
  } else {
    pass('node_modules present');
    for (const dep of Object.keys(packageJson.dependencies || {})) {
      try {
        require.resolve(dep, { paths: [ROOT] });
        pass(`${dep} resolved`);
      } catch {
        fail(`${dep} is missing`);
      }
    }
  }

  section('better-sqlite3 native module');
  try {
    const Database = require(require.resolve('better-sqlite3', { paths: [ROOT] }));
    const mem = new Database(':memory:');
    mem.close();
    pass('better-sqlite3 loads');
  } catch (err) {
    fail(`better-sqlite3 cannot load: ${err.message}`);
  }

  section('FFmpeg');
  for (const bin of ['ffmpeg', 'ffprobe']) {
    const version = commandVersion(bin);
    if (version) pass(`${bin}: ${version}`);
    else fail(installHintFor(bin));
  }

  section('Directories');
  const vaultPath = path.resolve(ROOT, env.VAULT_PATH || './vault');
  const dataPath = path.resolve(ROOT, env.DATA_PATH || './data');
  const logsPath = path.resolve(ROOT, env.LOG_PATH || './logs');
  const hlsPath = path.resolve(ROOT, env.HLS_OUTPUT_PATH || './hls_output');

  ensureDir(dataPath, 'data directory');
  ensureDir(logsPath, 'logs directory');
  ensureDir(path.join(hlsPath, 'stream'), 'HLS stream directory');
  ensureDir(path.join(hlsPath, 'previews'), 'preview directory');
  ensureDir(vaultPath, 'vault directory');

  for (const subdir of ['music', 'beats', 'podcasts', 'videos', 'drafts', 'live_sessions']) {
    ensureDir(path.join(vaultPath, subdir), `vault/${subdir}`);
  }

  section('Vault media');
  const supported = new Set(['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a', '.aiff', '.opus', '.mp4', '.mov', '.mkv', '.avi', '.webm', '.m4v']);
  let count = 0;
  function countMedia(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) countMedia(full);
      else if (supported.has(path.extname(entry.name).toLowerCase())) count++;
    }
  }
  try {
    countMedia(vaultPath);
    if (count > 0) pass(`${count} media file(s) found`);
    else warn('Vault is empty - add media before expecting a live broadcast');
  } catch (err) {
    fail(`Could not scan vault: ${err.message}`);
  }

  section('Port');
  const port = parseInt(env.PORT || '3000', 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    fail(`Invalid PORT: ${env.PORT}`);
  } else {
    await checkPort(port);
  }

  section('Payments');
  const stripeKeys = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_SUBSCRIBER', 'STRIPE_PRICE_PRO', 'STRIPE_PRICE_ALL_ACCESS'];
  if (hasAny(env, stripeKeys)) {
    if (env.STRIPE_SECRET_KEY) pass('Stripe secret key is set');
    else fail('Stripe values are partially configured but STRIPE_SECRET_KEY is missing');
    if (env.STRIPE_WEBHOOK_SECRET) pass('Stripe webhook secret is set');
    else warn('STRIPE_WEBHOOK_SECRET missing - subscription state will not be authoritative');
  } else {
    warn('Stripe not configured - payments, subscriptions, tips, and vault checkout are disabled');
  }

  const paypalKeys = ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_WEBHOOK_ID', 'PAYPAL_PLAN_PRO', 'PAYPAL_PLAN_ALL_ACCESS'];
  if (hasAny(env, paypalKeys)) {
    for (const key of ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_WEBHOOK_ID']) {
      if (env[key]) pass(`${key} is set`);
      else fail(`PayPal is partially configured but ${key} is missing`);
    }
  } else {
    warn('PayPal not configured');
  }

  section('Result');
  if (ok) {
    console.log('Preflight passed.');
  } else {
    console.log('Preflight failed. Fix the FAIL items before packaging.');
    process.exitCode = 1;
  }
}

main().catch(err => {
  console.error(`Preflight crashed: ${err.stack || err.message}`);
  process.exit(1);
});
