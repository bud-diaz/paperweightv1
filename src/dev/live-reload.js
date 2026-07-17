'use strict';

const chokidar = require('chokidar');

const CLIENT_ROUTE = '/__paperweight_dev_reload/client.js';
const EVENTS_ROUTE = '/__paperweight_dev_reload/events';

function installDevReload(app, { watchPaths = [] } = {}) {
  const clients = new Set();
  const debounceMs = parseInt(process.env.PAPERWEIGHT_DEV_RELOAD_DELAY_MS || '120', 10);
  let reloadTimer = null;

  function broadcast(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) {
      res.write(payload);
    }
  }

  function scheduleReload(filePath) {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      broadcast('reload', { path: filePath || null, at: Date.now() });
    }, debounceMs);
  }

  const watcher = chokidar.watch(watchPaths, {
    ignoreInitial: true,
    ignored: /(^|[/\\])\../,
    awaitWriteFinish: {
      stabilityThreshold: 100,
      pollInterval: 50,
    },
  });

  watcher.on('all', (event, filePath) => {
    if (['add', 'change', 'unlink'].includes(event)) {
      scheduleReload(filePath);
    }
  });

  watcher.on('error', err => {
    console.warn(`[Paperweight dev] Live reload watcher error: ${err.message}`);
  });

  app.get(CLIENT_ROUTE, (req, res) => {
    res.type('application/javascript');
    res.setHeader('Cache-Control', 'no-store');
    res.send(`
(() => {
  const source = new EventSource('${EVENTS_ROUTE}');
  source.addEventListener('reload', () => {
    window.location.reload();
  });
  source.onerror = () => {
    // EventSource reconnects automatically; keep this silent for normal restarts.
  };
})();
`);
  });

  app.get(EVENTS_ROUTE, (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 1000\n\n');
    clients.add(res);

    req.on('close', () => {
      clients.delete(res);
    });
  });

  const heartbeat = setInterval(() => {
    for (const res of clients) {
      res.write(': heartbeat\n\n');
    }
  }, 30000);
  heartbeat.unref?.();

  function injectHtml(html) {
    if (!html || html.includes(CLIENT_ROUTE)) return html;

    const tag = `<script src="${CLIENT_ROUTE}" defer></script>`;
    if (html.includes('</body>')) {
      return html.replace('</body>', `  ${tag}\n</body>`);
    }
    return `${html}\n${tag}\n`;
  }

  async function close() {
    clearInterval(heartbeat);
    clearTimeout(reloadTimer);
    for (const res of clients) {
      res.end();
    }
    clients.clear();
    await watcher.close();
  }

  return { injectHtml, close };
}

module.exports = { installDevReload };
