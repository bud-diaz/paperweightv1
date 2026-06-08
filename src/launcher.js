/**
 * Entry point used when Paperweight is packaged as a desktop executable.
 *
 * Normal source installs run `node src/index.js` directly. Packaged builds use
 * this wrapper so the app can open the local station URL after startup.
 */

'use strict';

const http = require('http');
const { exec } = require('child_process');

const PORT = parseInt(process.env.PORT || '3000', 10);
const url = `http://localhost:${PORT}`;

const app = require('./index');

app.start().catch(err => {
  console.error('[Paperweight] Failed to start:', err);
  process.exit(1);
});

function openBrowser(target) {
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
    res.resume();
    // Allow headless/automated runs (e.g. the clean-folder exe smoke) to skip it.
    if (process.env.PAPERWEIGHT_NO_BROWSER === 'true') {
      console.log(`[Paperweight] Server ready at: ${url}`);
      return;
    }
    console.log(`[Paperweight] Opening browser -> ${url}`);
    openBrowser(url);
  });

  req.on('error', () => {
    setTimeout(() => waitForServer(attemptsLeft - 1), 500);
  });

  req.end();
}

setTimeout(() => waitForServer(60), 500);

// Shut down cleanly on Ctrl+C / termination so the broadcast (ffmpeg) and HTTP
// server stop and the database is closed. index.js only self-registers these
// handlers when run directly (require.main === module), which is not the case
// under this launcher, so wire them to the exported shutdown() here.
function handleSignal(signal) {
  console.log(`\n[Paperweight] Received ${signal}, shutting down...`);
  app.shutdown();
}
process.on('SIGINT', () => handleSignal('SIGINT'));
process.on('SIGTERM', () => handleSignal('SIGTERM'));
