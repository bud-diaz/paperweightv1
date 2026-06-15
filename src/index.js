const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const { initDb, closeDb, log } = require('./db');
const { startScanner, stopScanner } = require('./scanner');
const broadcast = require('./broadcast');
const live = require('./broadcast/live');
const apiRouter = require('./api/router');
const { csrfCheck } = require('./middleware/csrfCheck');
const asyncHandler = require('./middleware/asyncHandler');
const { getFFmpegStatus } = require('./runtime/ffmpeg');

const isPackaged = typeof process.pkg !== 'undefined';

let server;
let isShuttingDown = false;
let fatalExitCode = 0;

function hlsAssetPath() {
  return path.join(config.paths.app, 'node_modules', 'hls.js', 'dist', 'hls.min.js');
}

// When packaged (pkg/node20), asset globs in package.json are not bundled.
// All client files and hls.js are embedded in src/client-bundle.js instead.
function bundledStaticMiddleware() {
  const bundle = require('./client-bundle');
  return (req, res, next) => {
    const entry = bundle[req.path];
    if (!entry) return next();
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Content-Type', entry.mime);
    res.end(entry.data);
  };
}

function createApp() {
  const app = express();
  if (config.trustProxy !== false) {
    app.set('trust proxy', config.trustProxy);
  }

  app.post('/api/payment/webhook/stripe',
    express.raw({ type: 'application/json' }),
    asyncHandler(require('./api/payment').stripeWebhookHandler)
  );

  app.use(express.json());
  app.use(cookieParser());
  app.use(csrfCheck);

  app.use('/hls/stream', express.static(path.join(config.paths.hlsOutput, 'stream')));
  app.use('/hls/live',   express.static(path.join(config.paths.hlsOutput, 'live')));

  app.get('/vendor/hls.min.js', (req, res) => {
    if (isPackaged) {
      const entry = require('./client-bundle')['/vendor/hls.min.js'];
      if (entry) {
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.setHeader('Content-Type', 'text/javascript');
        return res.end(entry.data);
      }
    }
    const asset = hlsAssetPath();
    if (!fs.existsSync(asset)) {
      return res.status(404).type('text/plain').send('hls.js asset not installed');
    }
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(asset);
  });

  app.use('/api', apiRouter);

  // User-side overrides (files placed next to the exe) take precedence.
  app.use(express.static(path.join(config.paths.root, 'client')));
  // In packaged builds asset globs don't work with node20; serve from the JS bundle.
  if (isPackaged) {
    app.use(bundledStaticMiddleware());
  } else {
    app.use(express.static(path.join(config.paths.app, 'client')));
  }

  app.get('/landing', (req, res) => {
    res.redirect('/creator.html');
  });

  // Legal pages
  app.get('/landing/license', (req, res) => {
    res.sendFile(path.join(config.paths.app, 'landing', 'license.html'));
  });
  app.get('/landing/content-responsibility', (req, res) => {
    res.sendFile(path.join(config.paths.app, 'landing', 'content-responsibility.html'));
  });
  app.get('/landing/download', (req, res) => {
    res.sendFile(path.join(config.paths.app, 'landing', 'download.html'));
  });

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

  app.get('/icon.png', (req, res) => {
    const name = config.station.name || 'P';
    const letter = name.trim()[0]?.toUpperCase() || 'P';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
      <rect width="512" height="512" rx="96" fill="#0a0a0a"/>
      <circle cx="256" cy="256" r="190" fill="none" stroke="rgba(255,255,255,.15)" stroke-width="1"/>
      <text x="256" y="310" text-anchor="middle" font-family="Georgia,serif" font-size="220" fill="#ffffff">${letter}</text>
    </svg>`;
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(svg);
  });

  app.get('*', (req, res) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/hls')) {
      return res.status(404).json({ error: 'Not found' });
    }
    const override = path.join(config.paths.root, 'client', 'creator.html');
    if (fs.existsSync(override)) return res.sendFile(override);
    if (isPackaged) {
      const entry = require('./client-bundle')['/creator.html'];
      if (entry) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.end(entry.data);
      }
    }
    res.sendFile(path.join(config.paths.app, 'client', 'creator.html'));
  });

  app.use((err, req, res, next) => {
    try { log('error', 'server', `Request error: ${err.message}`); } catch {}
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return app;
}

function fatalShutdown(kind, err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[FATAL] ${kind}:`, err);
  try { log('error', 'server', `${kind}: ${msg}`); } catch {}
  fatalExitCode = 1;

  try {
    shutdown();
  } catch (shutdownErr) {
    console.error('[FATAL] Shutdown after fatal error failed:', shutdownErr);
    process.exit(1);
  }
}

async function start() {
  initDb();
  const ffmpegStatus = getFFmpegStatus();
  if (!ffmpegStatus.ok) {
    console.error(`[Paperweight] ${ffmpegStatus.message}`);
    try { log('error', 'server', ffmpegStatus.message); } catch {}
  }
  startScanner();
  broadcast.start('shuffle');

  const app = createApp();
  server = app.listen(config.port, config.host);

  server.on('listening', () => {
    log('info', 'server', `Paperweight running on ${config.host}:${config.port}`);
    log('info', 'server', `Station: ${config.station.name}`);
    if (config.trustProxy !== false) {
      log('info', 'server', `Trust proxy enabled: ${config.trustProxy}`);
    }
    if (config.host === '0.0.0.0' || config.host === '::') {
      const msg = 'HOST is bound to all interfaces; this station is reachable on the LAN. Set HOST=127.0.0.1 for local-only use.';
      console.warn(`[Paperweight] ${msg}`);
      try { log('warn', 'server', msg); } catch {}
    }
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

  return server;
}

function shutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;

  try { log('info', 'server', 'Shutting down...'); } catch {}
  live.stopLive();
  broadcast.stop();
  stopScanner();

  if (server) {
    server.close(() => {
      closeDb();
      process.exit(fatalExitCode);
    });
    setTimeout(() => {
      console.error('[WARN] Graceful shutdown timed out, forcing exit');
      process.exit(fatalExitCode || 1);
    }, 5000).unref();
  } else {
    closeDb();
    process.exit(fatalExitCode);
  }
}

if (require.main === module) {
  process.on('uncaughtException', err => fatalShutdown('Uncaught exception', err));
  process.on('unhandledRejection', reason => fatalShutdown('Unhandled rejection', reason));
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  start().catch(err => {
    console.error('Failed to start Paperweight:', err);
    process.exit(1);
  });
}

module.exports = { createApp, start, shutdown, hlsAssetPath };
