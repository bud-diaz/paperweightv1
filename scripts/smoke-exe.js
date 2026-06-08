#!/usr/bin/env node
// Clean-folder smoke test for a BUILT Paperweight executable.
//
// Launches the exe in a fresh, empty working directory and runs the HTTP smoke
// against it. This proves a packaged binary self-bootstraps with nothing beside
// it: it must create its own .env (with generated secrets), data/paperweight.db,
// and hls_output/stream/, apply all migrations, and serve the locally-vendored
// frontend (no CDN). This is the "clean-folder smoke test" referenced in
// RELEASE_CHECKLIST.md.
//
// Usage:  node scripts/smoke-exe.js [path-to-exe]
// With no argument it picks the platform-matching artifact from dist/.
//
// Run this on the SAME OS/arch you built for — a native module built for one
// platform will not load on another.

'use strict';

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const PORT = parseInt(process.env.PAPERWEIGHT_SMOKE_PORT || '3970', 10);
const BOOT_TIMEOUT_MS = parseInt(process.env.PAPERWEIGHT_SMOKE_BOOT_MS || '30000', 10);

function defaultExe() {
  switch (process.platform) {
    case 'win32':  return path.join(DIST, 'paperweight-win.exe');
    case 'darwin': return path.join(DIST, 'paperweight-macos-x64');
    default:       return path.join(DIST, 'paperweight-linux-x64');
  }
}

const exePath = process.argv[2] ? path.resolve(process.argv[2]) : defaultExe();
if (!fs.existsSync(exePath)) {
  console.error(`ERROR: executable not found: ${exePath}`);
  console.error('Build it first with: npm run build:exe');
  process.exit(1);
}

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-exe-smoke-'));
console.log(`Clean-folder smoke for ${path.basename(exePath)}`);
console.log(`  working dir: ${workDir}`);
console.log(`  port:        ${PORT}\n`);

// Fresh env: force the port, suppress the browser, and make sure we don't leak a
// test-mode flag that would stop the exe from creating its own .env.
const childEnv = { ...process.env, PORT: String(PORT), PAPERWEIGHT_NO_BROWSER: 'true' };
delete childEnv.PAPERWEIGHT_ALLOW_MISSING_ENV;

const child = spawn(exePath, [], {
  cwd: workDir,
  env: childEnv,
  stdio: ['ignore', 'inherit', 'inherit'],
  detached: process.platform !== 'win32', // own process group so we can kill ffmpeg children too
});

let killed = false;
function killTree() {
  if (killed) return;
  killed = true;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      process.kill(-child.pid, 'SIGKILL'); // whole process group (exe + ffmpeg)
    }
  } catch { /* already gone */ }
}
process.on('exit', killTree);
process.on('SIGINT', () => { killTree(); process.exit(130); });

function httpStatus(pathname) {
  return new Promise(resolve => {
    const req = require('http').get(
      { host: '127.0.0.1', port: PORT, path: pathname, timeout: 3000 },
      res => { res.resume(); resolve(res.statusCode); }
    );
    req.on('timeout', () => { req.destroy(); resolve(0); });
    req.on('error', () => resolve(0));
  });
}

async function waitForBoot() {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`exe exited early (code ${child.exitCode})`);
    if ((await httpStatus('/api/health')) === 200) return;
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`exe did not serve /api/health within ${BOOT_TIMEOUT_MS}ms`);
}

(async () => {
  let ok = true;
  try {
    await waitForBoot();
    console.log('OK   exe booted and is serving\n');

    // The exe must have bootstrapped these into the previously-empty folder.
    for (const rel of ['.env', path.join('data', 'paperweight.db'), path.join('hls_output', 'stream')]) {
      if (fs.existsSync(path.join(workDir, rel))) {
        console.log(`OK   created ${rel}`);
      } else {
        console.log(`FAIL missing ${rel}`);
        ok = false;
      }
    }
    console.log('');

    // Run the shared HTTP smoke (health, manifest, dashboard 401, library, SPA,
    // and the locally-vendored hls.js + fonts).
    const smoke = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'smoke.js'), `http://127.0.0.1:${PORT}`], { stdio: 'inherit' });
    if (smoke.status !== 0) ok = false;
  } catch (err) {
    console.error(`\nClean-folder exe smoke crashed: ${err.message}`);
    ok = false;
  } finally {
    killTree();
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }

  if (!ok) { console.log('\nClean-folder exe smoke FAILED.'); process.exit(1); }
  console.log('\nClean-folder exe smoke passed.');
  process.exit(0);
})();
