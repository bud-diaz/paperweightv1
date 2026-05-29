const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const config = require('./config');
const { initDb, closeDb, log } = require('./db');
const { startScanner, stopScanner } = require('./scanner');
const broadcast = require('./broadcast');
const apiRouter = require('./api/router');
const { csrfCheck } = require('./middleware/csrfCheck');

const app = express();
let server;
let isShuttingDown = false;

// ─── Catch unhandled errors before they take the process down ────────────────

process.on('uncaughtException', err => {
  console.error('[FATAL] Uncaught exception:', err);
  // Don't exit — log and continue. DB logger may not be ready yet.
  try { log('error', 'server', `Uncaught exception: ${err.message}`); } catch {}
});

process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  console.error('[WARN] Unhandled rejection:', msg);
  try { log('warn', 'server', `Unhandled rejection: ${msg}`); } catch {}
});

// ─── App setup ───────────────────────────────────────────────────────────────

function createApp() {
  // Stripe webhook must receive the raw body before express.json() parses it.
  // Mount this single route before any body parsers.
  app.post('/api/payment/webhook/stripe',
    express.raw({ type: 'application/json' }),
    require('./api/payment').stripeWebhookHandler
  );

  app.use(express.json());
  app.use(cookieParser());
  app.use(csrfCheck);

  // Serve HLS output
  app.use('/hls', express.static(config.paths.hlsOutput));

  // API routes
  app.use('/api', apiRouter);

  // Serve frontend (config.paths.app points to the bundled client/ dir,
  // which lives inside the pkg snapshot when running as a packaged exe)
  app.use(express.static(path.join(config.paths.app, 'client')));

  // SPA fallback — serve index.html for any unmatched GET
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/hls')) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.sendFile(path.join(config.paths.app, 'client', 'index.html'));
  });

  // Express error handler — catches sync throws and next(err) calls
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    log('error', 'server', `Request error: ${err.message}`);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return app;
}

// ─── Startup ─────────────────────────────────────────────────────────────────

async function start() {
  initDb();
  startScanner();
  broadcast.start('shuffle');
  createApp();

  server = app.listen(config.port);

  server.on('listening', () => {
    log('info', 'server', `Paperweight running on port ${config.port}`);
    log('info', 'server', `Station: ${config.station.name}`);
  });

  server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[ERROR] Port ${config.port} is already in use.`);
      console.error('        Change PORT in .env or stop the other process.');
    } else {
      console.error('[ERROR] Server error:', err.message);
    }
    process.exit(1);
  });
}

// ─── Graceful shutdown ───────────────────────────────────────────────────────

function shutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;

  log('info', 'server', 'Shutting down...');
  broadcast.stop();
  stopScanner();

  if (server) {
    server.close(() => {
      closeDb();
      process.exit(0);
    });
    // Force exit if graceful shutdown takes too long
    setTimeout(() => {
      console.error('[WARN] Graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, 5000).unref();
  } else {
    closeDb();
    process.exit(0);
  }
}

process.on('SIGTERM', shutdown);
process.on('SIGINT',  shutdown);

start().catch(err => {
  console.error('Failed to start Paperweight:', err);
  process.exit(1);
});
