const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
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

  // Serve frontend — check dataRoot/client/ first so users can drop
  // replacement files next to the exe without rebuilding the package.
  app.use(express.static(path.join(config.paths.root, 'client')));
  app.use(express.static(path.join(config.paths.app,  'client')));

  // Marketing/about page accessible at /landing
  app.get('/landing', (req, res) => {
    res.sendFile(path.join(config.paths.app, 'client', 'index.html'));
  });

  // PWA manifest — dynamic so it picks up the configured station name
  app.get('/manifest.json', (req, res) => {
    const name = config.station.name || 'Paperweight';
    res.json({
      name,
      short_name: name.length > 12 ? name.slice(0, 12) : name,
      description: config.station.creatorDesc || '',
      start_url: '/',
      display: 'standalone',
      background_color: '#0a0a0a',
      theme_color: '#0a0a0a',
      orientation: 'portrait-primary',
      icons: [
        { src: '/icon.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
        { src: '/icon.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
      ],
    });
  });

  // PWA icon — generated SVG served as PNG-compatible (place a real icon.png in client/ to override)
  app.get('/icon.png', (req, res) => {
    if (!res.headersSent) {
      const name  = config.station.name || 'P';
      const letter = name.trim()[0]?.toUpperCase() || 'P';
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
        <rect width="512" height="512" rx="96" fill="#0a0a0a"/>
        <circle cx="256" cy="256" r="190" fill="none" stroke="rgba(255,255,255,.15)" stroke-width="1"/>
        <text x="256" y="310" text-anchor="middle" font-family="Georgia,serif" font-size="220" fill="#ffffff">${letter}</text>
      </svg>`;
      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(svg);
    }
  });

  // SPA fallback — serve creator.html (player) for any unmatched GET.
  // Prefer the override file next to the exe (dataRoot) over the bundled copy.
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/hls')) {
      return res.status(404).json({ error: 'Not found' });
    }
    const override  = path.join(config.paths.root, 'client', 'creator.html');
    const bundled   = path.join(config.paths.app,  'client', 'creator.html');
    res.sendFile(fs.existsSync(override) ? override : bundled);
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
