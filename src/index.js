const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const { initDb, closeDb, log } = require('./db');
const { startScanner, stopScanner } = require('./scanner');
const releaseScheduler = require('./release/scheduler');
const broadcast = require('./broadcast');
const live = require('./broadcast/live');
const liveVideo = require('./broadcast/liveVideo');
const apiRouter = require('./api/router');
const { attachTier } = require('./auth/middleware');
const { meetsMinTier } = require('./auth/access');
const { getSetting } = require('./db/settings');
const { validateSession } = require('./auth/sessions');
const { csrfCheck } = require('./middleware/csrfCheck');
const asyncHandler = require('./middleware/asyncHandler');
const { getFFmpegStatus } = require('./runtime/ffmpeg');
const telemetry = require('./telemetry/reporter');
const tunnelSupervisor = require('./runtime/tunnel-supervisor');
const frpSupervisor = require('./runtime/frp-supervisor');
const { recordMilestone } = require('./runtime/funnel');
const jobRunner = require('./jobs/runner');

const isPackaged = typeof process.pkg !== 'undefined';
const isBundledRuntime = isPackaged || process.env.PAPERWEIGHT_DESKTOP_RUNTIME === 'true';

let server;
let isShuttingDown = false;
let fatalExitCode = 0;
let devReloadCleanup = null;

function hlsAssetPath() {
  return path.join(config.paths.app, 'node_modules', 'hls.js', 'dist', 'hls.min.js');
}

function matterAssetPath() {
  return path.join(config.paths.app, 'node_modules', 'matter-js', 'build', 'matter.min.js');
}

function clientMatterAssetPath() {
  return path.join(config.paths.app, 'client', 'vendor', 'matter.min.js');
}

function sendBundledAsset(res, urlPath, contentType) {
  try {
    const entry = require('./client-bundle')[urlPath];
    if (!entry) return false;
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Content-Type', contentType || entry.mime);
    res.end(entry.data);
    return true;
  } catch {
    return false;
  }
}

function sendBrandedPng(res, urlPath, fallbackFile) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  if (isBundledRuntime && sendBundledAsset(res, urlPath, 'image/png')) return;
  res.type('image/png').sendFile(fallbackFile);
}

// When bundled for pkg or the hardened Electron runtime, client files and
// vendored browser libraries are embedded in src/client-bundle.js instead of
// being served from a raw client/ directory.
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

// Strict Content-Security-Policy for the app + dashboard. The Studio SPA build
// loads no inline scripts and no inline event handlers, so script-src can stay
// 'self'. 'unsafe-inline' is kept only for style-src (React sets some inline
// style="…" attributes); style injection is far lower risk than script
// injection.
const APP_CSP_DIRECTIVES = {
  defaultSrc: ["'self'"],
  scriptSrc:  ["'self'"],
  styleSrc:   ["'self'", "'unsafe-inline'"],
  imgSrc:     ["'self'", 'data:', 'blob:'],
  mediaSrc:   ["'self'", 'blob:'],
  // The public station directory powers the player's wordmark station search.
  connectSrc: ["'self'", 'https://system.paperweighthq.com'],
  workerSrc:  ["'self'", 'blob:'],
  fontSrc:    ["'self'"],
  objectSrc:  ["'none'"],
  frameAncestors: ["'none'"],
  baseUri:    ["'self'"],
  formAction: ["'self'"],
};

// The /embed mini player must be frameable on other sites — that is its whole
// point — so it swaps frame-ancestors 'none' for * and drops X-Frame-Options.
// It carries no auth and only plays the public stream.
const EMBED_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; " +
  "worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors *";

function relaxCspForEmbed(req, res, next) {
  res.setHeader('Content-Security-Policy', EMBED_CSP);
  res.removeHeader('X-Frame-Options');
  next();
}

// The static /landing/* marketing pages use inline <script>, inline on* handlers,
// and <style> blocks, so they need a looser policy. They carry no auth and no
// sensitive data, but still get object-src/frame-ancestors locked down.
const LANDING_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob:; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'";

function relaxCspForLanding(req, res, next) {
  res.setHeader('Content-Security-Policy', LANDING_CSP);
  next();
}

// license.html and content-responsibility.html are also framed inline inside
// the creator-mode Docs modal (client/js/docs.js) — same-origin only, so
// frame-ancestors 'self' rather than the '*' the /embed route needs. Scoped
// to just these two routes; /landing/download and /landing/listen have no
// reason to become frameable.
const LANDING_CSP_EMBEDDABLE = LANDING_CSP.replace("frame-ancestors 'none'", "frame-ancestors 'self'");
function relaxCspForLandingEmbeddable(req, res, next) {
  res.setHeader('Content-Security-Policy', LANDING_CSP_EMBEDDABLE);
  next();
}

const LISTEN_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; " +
  "style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob:; font-src 'self'; " +
  "connect-src 'self' https://system.paperweighthq.com; frame-src https:; " +
  "object-src 'none'; base-uri 'self'; frame-ancestors 'none'";

function relaxCspForListen(req, res, next) {
  res.setHeader('Content-Security-Policy', LISTEN_CSP);
  next();
}

// Gate for the paid-tier live video HLS output. This — not the frontend CTA —
// is the actual access boundary: every .m3u8 and .ts segment request under
// /hls/live-video is tier-checked here before express.static ever serves it.
//
// The creator's own authenticated dashboard session bypasses the tier check
// so they can monitor their own live video output from the studio dashboard
// (on-air preview player) without also needing a qualifying listener token —
// the dashboard session cookie and the listener tier system are otherwise
// completely separate. This only recognizes the station owner's own session,
// not any listener credential, so listener-side tier gating is unaffected.
function requireLiveVideoAccess(req, res, next) {
  const sessionId = req.cookies?.pw_dashboard_session;
  if (sessionId && validateSession(sessionId)) return next();

  const minTier = getSetting('live_video_min_tier') || 'subscriber';
  if (meetsMinTier(req.tier, minTier)) return next();
  res.status(403).json({ error: 'Subscriber access required to watch live video' });
}

function createApp() {
  const app = express();
  if (config.trustProxy !== false) {
    app.set('trust proxy', config.trustProxy);
  }

  app.use(helmet({
    contentSecurityPolicy: { useDefaults: false, directives: APP_CSP_DIRECTIVES },
    xFrameOptions: { action: 'deny' },
    // HSTS is meaningful only over HTTPS; self-hosted HTTP deployments skip it.
    strictTransportSecurity: config.https ? undefined : false,
    // Cross-origin isolation headers left at helmet defaults (COEP off) so the
    // player and its blob-based HLS media keep working same-origin.
  }));

  app.post('/api/payment/webhook/stripe',
    express.raw({ type: 'application/json' }),
    asyncHandler(require('./api/payment').stripeWebhookHandler)
  );

  app.use(express.json());
  app.use(cookieParser());
  app.use(csrfCheck);

  const devReload = process.env.PAPERWEIGHT_DEV_RELOAD === 'true'
    ? require('./dev/live-reload').installDevReload(app, {
        watchPaths: [
          path.join(config.paths.app, 'client'),
          path.join(config.paths.app, 'landing'),
        ],
      })
    : null;
  if (devReload) devReloadCleanup = devReload.close;

  function sendHtmlFile(res, filePath) {
    if (!devReload) return res.sendFile(filePath);

    fs.readFile(filePath, 'utf8', (err, html) => {
      if (err) {
        const status = err.code === 'ENOENT' ? 404 : 500;
        return res.status(status).type('text/plain').send(
          status === 404 ? 'File not found' : 'Failed to read HTML file'
        );
      }
      res.setHeader('Cache-Control', 'no-store');
      res.type('html').send(devReload.injectHtml(html));
    });
  }

  // Serves the Studio SPA build (studio/, built to client/app/) — the sole
  // frontend as of the creator.html -> Studio cutover. Same override (files
  // placed next to the exe) -> bundle (packaged/Electron) -> disk precedence
  // creator.html always used, just repointed at client/app/index.html.
  function sendAppHtml(res) {
    const override = path.join(config.paths.root, 'client', 'app', 'index.html');
    if (fs.existsSync(override)) return sendHtmlFile(res, override);
    if (isBundledRuntime) {
      const entry = require('./client-bundle')['/app/index.html'];
      if (entry) {
        const html = devReload ? devReload.injectHtml(entry.data.toString('utf8')) : entry.data;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.end(html);
      }
    }
    return sendHtmlFile(res, path.join(config.paths.app, 'client', 'app', 'index.html'));
  }

  app.use('/hls/stream', express.static(path.join(config.paths.hlsOutput, 'stream')));
  app.use('/hls/live',   express.static(path.join(config.paths.hlsOutput, 'live')));
  app.use('/hls/live-video', attachTier, requireLiveVideoAccess,
    express.static(path.join(config.paths.hlsOutput, 'live-video')));

  app.get('/vendor/hls.min.js', (req, res) => {
    if (isBundledRuntime) {
      if (sendBundledAsset(res, '/vendor/hls.min.js', 'text/javascript')) return;
    }
    const asset = hlsAssetPath();
    if (!fs.existsSync(asset)) {
      return res.status(404).type('text/plain').send('hls.js asset not installed');
    }
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(asset);
  });

  app.get('/vendor/matter.min.js', (req, res) => {
    if (isBundledRuntime) {
      if (sendBundledAsset(res, '/vendor/matter.min.js', 'text/javascript')) return;
    }
    const asset = matterAssetPath();
    if (fs.existsSync(asset)) {
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.sendFile(asset);
    }
    if (sendBundledAsset(res, '/vendor/matter.min.js', 'text/javascript')) return;
    const clientAsset = clientMatterAssetPath();
    if (!fs.existsSync(clientAsset)) {
      return res.status(404).type('text/plain').send('matter-js asset not installed');
    }
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(clientAsset);
  });

  app.use('/api', apiRouter);

  if (devReload) {
    app.get(['/', '/creator.html', '/studio'], (req, res) => {
      sendAppHtml(res);
    });
  }

  // User-side overrides (files placed next to the exe) take precedence.
  app.use(express.static(path.join(config.paths.root, 'client')));
  // In packaged builds asset globs don't work with node20; serve from the JS bundle.
  if (isBundledRuntime) {
    app.use(bundledStaticMiddleware());
  } else {
    app.use(express.static(path.join(config.paths.app, 'client')));
  }

  // Public RSS/podcast feed (creator-enabled via dashboard settings).
  const feed = require('./api/feed');
  app.get('/feed.xml', asyncHandler(feed.feedXml));
  app.get('/feed/enclosure/:id', asyncHandler(feed.enclosure));

  // Embeddable mini player — served like other client assets but with a
  // frameable CSP. Overrides next to the exe win, then bundle, then app files.
  app.get('/embed', relaxCspForEmbed, (req, res) => {
    const override = path.join(config.paths.root, 'client', 'embed.html');
    if (fs.existsSync(override)) return sendHtmlFile(res, override);
    if (isBundledRuntime) {
      const entry = require('./client-bundle')['/embed.html'];
      if (entry) {
        const html = devReload ? devReload.injectHtml(entry.data.toString('utf8')) : entry.data;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.end(html);
      }
    }
    sendHtmlFile(res, path.join(config.paths.app, 'client', 'embed.html'));
  });

  // Mobile Studio device-pairing confirmation page — a QR code generated from
  // an already-authenticated Studio session links here. Not gated by
  // requireDashboard (that's the point: this is how a new device signs in).
  app.get('/pair', (req, res) => {
    const override = path.join(config.paths.root, 'client', 'pair.html');
    if (fs.existsSync(override)) return sendHtmlFile(res, override);
    if (isBundledRuntime) {
      const entry = require('./client-bundle')['/pair.html'];
      if (entry) {
        const html = devReload ? devReload.injectHtml(entry.data.toString('utf8')) : entry.data;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.end(html);
      }
    }
    sendHtmlFile(res, path.join(config.paths.app, 'client', 'pair.html'));
  });

  // /studio is no longer a distinct route: it was the side-by-side preview
  // path while the Studio SPA (studio/, built to client/app/) was being wired
  // up feature-by-feature. Now that it's the only frontend, /studio (and any
  // other unmatched path, including old /creator.html bookmarks) falls
  // through to the catch-all below, which serves the exact same SPA — no
  // separate route needed to keep old links working.

  app.get('/landing', (req, res) => {
    res.redirect('/');
  });

  // Legal pages — serve from the client bundle in packaged mode since
  // pkg.assets globs are broken for node20 targets and landing/ is not
  // inside the virtual snapshot.
  function serveLanding(bundleKey, diskFile) {
    return (req, res) => {
      if (isBundledRuntime) {
        const entry = require('./client-bundle')[bundleKey];
        if (entry) {
          const html = devReload ? devReload.injectHtml(entry.data.toString('utf8')) : entry.data;
          res.setHeader('Content-Type', entry.mime);
          return res.end(html);
        }
      }
      sendHtmlFile(res, path.join(config.paths.app, 'landing', diskFile));
    };
  }
  app.get('/landing/license',               relaxCspForLandingEmbeddable, serveLanding('/landing/license.html',               'license.html'));
  app.get('/landing/content-responsibility', relaxCspForLandingEmbeddable, serveLanding('/landing/content-responsibility.html', 'content-responsibility.html'));
  app.get('/landing/download',               relaxCspForLanding, serveLanding('/landing/download.html',               'download.html'));
  app.get('/landing/listen',                 relaxCspForListen,  serveLanding('/landing/listen.html',                 'listen.html'));
  app.get('/landing/privacy',                relaxCspForLanding, serveLanding('/landing/privacy.html',                'privacy.html'));
  app.get('/landing/terms',                  relaxCspForLanding, serveLanding('/landing/terms.html',                  'terms.html'));
  app.get('/landing/support',                relaxCspForLanding, serveLanding('/landing/support.html',                'support.html'));
  app.get('/landing/warranty',               relaxCspForLanding, serveLanding('/landing/warranty.html',               'warranty.html'));
  app.get('/landing/refund',                 relaxCspForLanding, serveLanding('/landing/refund.html',                 'refund.html'));
  app.get('/landing/station-ops',            relaxCspForLanding, serveLanding('/landing/station-ops.html',            'station-ops.html'));

  // Creator-mode "Docs" modal (client/js/docs.js) — README, per-platform
  // setup guides, and the Asciline third-party notice, none of which have a
  // hand-formatted HTML twin like license.html/content-responsibility.html
  // do. Served as plain text; the client renders Markdown itself
  // (client/js/markdown.js). Unauthenticated: same non-sensitive doc text
  // already public in the repo and via /landing/license et al. — the modal
  // is only reachable from creator-mode UI, but gating the route would add
  // friction with no real security benefit.
  const DOC_MANIFEST = require('./setup/docs-manifest');

  app.get('/api/docs', (req, res) => {
    res.json({ docs: DOC_MANIFEST.map(({ id, title }) => ({ id, title })) });
  });

  function serveDoc(entry) {
    return (req, res) => {
      if (isBundledRuntime) {
        const bundled = require('./client-bundle')[entry.urlPath];
        if (bundled) return res.type('text/plain; charset=utf-8').send(bundled.data.toString('utf8'));
      }
      fs.readFile(path.join(config.paths.app, entry.file), 'utf8', (err, content) => {
        if (err) return res.status(404).json({ error: 'Doc not found' });
        res.type('text/plain; charset=utf-8').send(content);
      });
    };
  }
  for (const entry of DOC_MANIFEST) {
    app.get(`/api/docs/${entry.id}`, serveDoc(entry));
  }

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
    sendBrandedPng(res, '/icon.png', path.join(config.paths.app, 'client', 'icon.png'));
  });

  // Studio-side routing for /share/:token lives in studio/src/pages/Share.tsx
  // (wouter route registered in studio/src/App.tsx) — this just serves the
  // same SPA shell so client-side routing can take over.
  app.get('/share/:token', (req, res) => {
    sendAppHtml(res);
  });

  app.get('*', (req, res) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/hls')) {
      return res.status(404).json({ error: 'Not found' });
    }
    sendAppHtml(res);
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

function finishShutdown() {
  closeDb();
  process.exitCode = fatalExitCode;
  setTimeout(() => {
    process.exit(fatalExitCode);
  }, 500).unref();
}

async function start() {
  initDb();
  // First successful DB init is the closest cross-distribution proxy for
  // "install completed" — INSERT OR IGNORE (migration 029) makes this a
  // no-op after the very first boot, on every distribution path.
  recordMilestone('install_completed');
  const ffmpegStatus = getFFmpegStatus();
  if (!ffmpegStatus.ok) {
    console.error(`[Paperweight] ${ffmpegStatus.message}`);
    try { log('error', 'server', ffmpegStatus.message); } catch {}
  }
  startScanner();
  releaseScheduler.start();
  broadcast.start('shuffle');

  // Resume the supervised cloudflared connector across restarts (see
  // src/runtime/tunnel-supervisor.js and the auto-tunnel dashboard route) —
  // it's a child process of this one, so it doesn't survive on its own.
  const provider = config.station.tunnelProvider;
  if (provider === 'frp' && config.station.frpTunnel && config.station.frp.configPath) {
    frpSupervisor.start(config.station.frp.configPath);
  } else if ((provider === 'cloudflare' || !provider) && config.station.cloudflareTunnel && process.env.CLOUDFLARE_TUNNEL_TOKEN) {
    tunnelSupervisor.start(process.env.CLOUDFLARE_TUNNEL_TOKEN);
  }

  const app = createApp();
  // createApp loads API modules, which register their durable job handlers.
  require('./ops').ensureSchedules();
  jobRunner.start();
  const configuredPort = config.port;

  // Try the configured port; if it's occupied, walk upward until a free one is
  // found (up to +10). config.port is updated to the actual bound port so the
  // launcher and any other callers always read the real address.
  await new Promise((resolve, reject) => {
    function tryBind(port) {
      if (port > configuredPort + 10) {
        return reject(new Error(
          `No free port found in range ${configuredPort}–${configuredPort + 10}. ` +
          'Set a different PORT in .env or free the port range.'
        ));
      }

      const srv = app.listen(port, config.host);

      srv.once('listening', () => {
        server = srv;
        const boundPort = srv.address().port;

        if (boundPort !== configuredPort) {
          const msg = `Port ${configuredPort} was in use — bound to port ${boundPort} instead.`;
          console.log(`[Paperweight] ${msg}`);
          try { log('warn', 'server', msg); } catch {}
          config.port = boundPort;
        }

        try { log('info', 'server', `Paperweight running on ${config.host}:${config.port}`); } catch {}
        try { log('info', 'server', `Station: ${config.station.name}`); } catch {}
        if (config.trustProxy !== false) {
          try { log('info', 'server', `Trust proxy enabled: ${config.trustProxy}`); } catch {}
        }
        if (config.host === '0.0.0.0' || config.host === '::') {
          const msg = 'HOST is bound to all interfaces; this station is reachable on the LAN. Set HOST=127.0.0.1 for local-only use.';
          console.warn(`[Paperweight] ${msg}`);
          try { log('warn', 'server', msg); } catch {}
        }

        telemetry.start();
        resolve();
      });

      srv.once('error', err => {
        if (err.code === 'EADDRINUSE') {
          srv.close(() => tryBind(port + 1));
        } else {
          reject(new Error(`Server bind error: ${err.message}`));
        }
      });
    }

    tryBind(configuredPort);
  });

  // Ongoing post-bind error handler (fatal errors after successful startup).
  server.on('error', err => {
    console.error('[ERROR] Server error:', err.message);
    fatalShutdown('Server error', err);
  });

  return server;
}

function shutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;

  try { log('info', 'server', 'Shutting down...'); } catch {}

  const forceTimer = setTimeout(() => {
    console.error('[WARN] Graceful shutdown timed out, forcing exit');
    process.exit(fatalExitCode || 1);
  }, 5000);
  forceTimer.unref();

  return Promise.resolve()
    .then(async () => {
      live.stopLive();
      liveVideo.stopLive();
      broadcast.stop();
      releaseScheduler.stop();
      jobRunner.stop();
      tunnelSupervisor.stop();
      frpSupervisor.stop();

      const cleanupTasks = [Promise.resolve(stopScanner())];
      if (devReloadCleanup) {
        cleanupTasks.push(Promise.resolve().then(devReloadCleanup));
        devReloadCleanup = null;
      }
      await Promise.allSettled(cleanupTasks);
    })
    .then(() => {
      if (!server) {
        finishShutdown();
        return;
      }

      return new Promise(resolve => {
        server.close(() => {
          finishShutdown();
          resolve();
        });
      });
    })
    .catch(err => {
      console.error('[ERROR] Shutdown failed:', err);
      clearTimeout(forceTimer);
      closeDb();
      process.exit(fatalExitCode || 1);
    });
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
