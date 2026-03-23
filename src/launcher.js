/**
 * launcher.js — entry point used when Paperweight is packaged as a .exe
 *
 * When pkg bundles the app, it uses this file as the main entry point instead
 * of index.js. It does two things beyond what index.js does:
 *
 *   1. Opens the user's default browser to the dashboard once the server is up.
 *   2. Keeps the console window alive with a friendly status line.
 *
 * Run normally: this file is NOT used — `node src/index.js` goes straight to index.js.
 */

'use strict';

const http = require('http');
const { exec } = require('child_process');

// ─── Config is loaded inside index.js, but we need the port here before that.
// Read PORT from env if already set; config.js will do the full .env parse.
const PORT = parseInt(process.env.PORT || '3000', 10);

// ─── Load the server ──────────────────────────────────────────────────────────
require('./index');

// ─── Open browser once server is ready ───────────────────────────────────────

const url = `http://localhost:${PORT}`;

function openBrowser(target) {
  // platform-specific open command
  const cmd = process.platform === 'darwin'
    ? `open "${target}"`
    : process.platform === 'win32'
      ? `start "" "${target}"`
      : `xdg-open "${target}"`;

  exec(cmd, err => {
    if (err) console.warn('[Paperweight] Could not open browser automatically:', err.message);
  });
}

function waitForServer(attemptsLeft) {
  if (attemptsLeft <= 0) {
    console.log(`[Paperweight] Server ready. Open your browser to: ${url}`);
    return;
  }

  const req = http.get(url, res => {
    res.resume(); // drain the response
    console.log(`[Paperweight] Opening browser → ${url}`);
    openBrowser(url);
  });

  req.on('error', () => {
    setTimeout(() => waitForServer(attemptsLeft - 1), 500);
  });

  req.end();
}

// Give the server ~500 ms head-start, then start polling (up to 30 s total).
setTimeout(() => waitForServer(60), 500);

// ─── Keep console window open & friendly ────────────────────────────────────

process.on('SIGINT',  () => { /* index.js handles shutdown */ });
process.on('SIGTERM', () => { /* index.js handles shutdown */ });
