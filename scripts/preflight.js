#!/usr/bin/env node
// Preflight check — run before first launch or after system changes.
// Usage: node scripts/preflight.js

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let ok = true;

function pass(msg)  { console.log(`  ✓  ${msg}`); }
function fail(msg)  { console.log(`  ✗  ${msg}`); ok = false; }
function warn(msg)  { console.log(`  ⚠  ${msg}`); }
function section(s) { console.log(`\n── ${s} ─────────────────────────`); }

// ── Node version ──────────────────────────────────────────────────────────────
section('Node.js');
const [major] = process.versions.node.split('.').map(Number);
if (major >= 18) {
  pass(`Node.js ${process.version}`);
} else {
  fail(`Node.js ${process.version} — v18+ required`);
}

// ── .env ─────────────────────────────────────────────────────────────────────
section('.env');
const envPath = path.join(ROOT, '.env');
if (fs.existsSync(envPath)) {
  pass('.env file found');
  const env = fs.readFileSync(envPath, 'utf8');
  if (env.includes('DASHBOARD_TOKEN=') && !env.match(/DASHBOARD_TOKEN=\s*\n/)) {
    pass('DASHBOARD_TOKEN is set');
  } else {
    fail('DASHBOARD_TOKEN is missing — re-run scripts/setup.sh');
  }
  if (env.match(/STATION_NAME=\s*\n/) || env.match(/STATION_NAME=My Station/)) {
    warn('STATION_NAME looks like a default — update in .env');
  } else {
    pass('STATION_NAME is set');
  }
} else {
  fail('.env not found — run: bash scripts/setup.sh');
}

// ── npm deps ──────────────────────────────────────────────────────────────────
section('npm dependencies');
const nmPath = path.join(ROOT, 'node_modules');
if (fs.existsSync(nmPath)) {
  pass('node_modules present');
} else {
  fail('node_modules missing — run: npm install');
}

// ── FFmpeg / FFprobe ──────────────────────────────────────────────────────────
section('FFmpeg');
function checkBin(name) {
  const result = spawnSync(name, ['-version'], { stdio: 'pipe' });
  if (result.status === 0) {
    const line = result.stdout.toString().split('\n')[0];
    pass(`${name}: ${line}`);
    return true;
  } else {
    fail(`${name} not found — install with: sudo apt install ffmpeg`);
    return false;
  }
}
checkBin('ffmpeg');
checkBin('ffprobe');

// ── Directories ───────────────────────────────────────────────────────────────
section('Directories');
const dirs = [
  ['data',                  'data/'],
  ['logs',                  'logs/'],
  ['hls_output/stream',     'hls_output/stream/'],
  ['hls_output/previews',   'hls_output/previews/'],
];

for (const [rel, label] of dirs) {
  const abs = path.join(ROOT, rel);
  if (fs.existsSync(abs)) {
    pass(`${label} exists`);
  } else {
    try {
      fs.mkdirSync(abs, { recursive: true });
      pass(`${label} created`);
    } catch {
      fail(`${label} missing and could not be created`);
    }
  }
}

// ── Vault ─────────────────────────────────────────────────────────────────────
section('Vault');
try {
  // Load config to get actual vault path
  const config = require('../src/config');
  const vaultPath = config.vault.path;
  if (fs.existsSync(vaultPath)) {
    pass(`Vault found: ${vaultPath}`);
    const subdirs = ['music', 'beats', 'podcasts', 'videos', 'drafts', 'live_sessions'];
    for (const d of subdirs) {
      const p = path.join(vaultPath, d);
      if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
    }
    // Count media files
    let count = 0;
    function countFiles(dir) {
      const exts = new Set(['.mp3','.wav','.flac','.aac','.ogg','.m4a','.mp4','.mov','.mkv']);
      try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.isDirectory()) countFiles(path.join(dir, entry.name));
          else if (exts.has(path.extname(entry.name).toLowerCase())) count++;
        }
      } catch {}
    }
    countFiles(vaultPath);
    if (count > 0) {
      pass(`${count} media file(s) found in vault`);
    } else {
      warn('Vault is empty — add media files to start broadcasting');
    }
  } else {
    fail(`Vault not found: ${vaultPath}`);
  }
} catch (e) {
  warn(`Could not check vault: ${e.message}`);
}

// ── HLS tmpfs (Pi recommendation) ────────────────────────────────────────────
section('HLS output (Pi recommendation)');
const hlsPath = path.join(ROOT, 'hls_output');
try {
  const mounts = execSync('mount 2>/dev/null || true').toString();
  if (mounts.includes(hlsPath) && mounts.includes('tmpfs')) {
    pass('hls_output is mounted as tmpfs ✓ (SD card protected)');
  } else {
    warn('hls_output is NOT on tmpfs — recommended for Pi SD card longevity');
    console.log('       Add to /etc/fstab:');
    console.log(`       tmpfs ${hlsPath} tmpfs defaults,noatime,size=100m 0 0`);
  }
} catch {
  warn('Could not check mount points (non-Linux system)');
}

// ── PM2 ───────────────────────────────────────────────────────────────────────
section('PM2');
const pm2 = spawnSync('pm2', ['--version'], { stdio: 'pipe' });
if (pm2.status === 0) {
  pass(`PM2 ${pm2.stdout.toString().trim()} found`);
} else {
  warn('PM2 not found — install with: npm install -g pm2');
  console.log('       Then run: pm2 start ecosystem.config.js && pm2 save && pm2 startup');
}

// ── Result ────────────────────────────────────────────────────────────────────
console.log('');
if (ok) {
  console.log('✓ All checks passed. Run: npm start  (or: pm2 start ecosystem.config.js)');
} else {
  console.log('✗ Some checks failed. Fix the issues above before starting Paperweight.');
  process.exit(1);
}
