'use strict';

process.env.NODE_ENV = process.env.NODE_ENV || 'development';
process.env.PAPERWEIGHT_DEV_RELOAD = process.env.PAPERWEIGHT_DEV_RELOAD || 'true';

const app = require('../src/index');
const config = require('../src/config');

function browserHost(host) {
  return host === '0.0.0.0' || host === '::' ? 'localhost' : host;
}

app.start().then(() => {
  const url = `http://${browserHost(config.host)}:${config.port}/creator.html`;
  console.log(`[Paperweight dev] Server ready: ${url}`);
  console.log('[Paperweight dev] Backend changes restart the server; frontend changes reload open browser tabs.');
}).catch(err => {
  console.error('[Paperweight dev] Failed to start:', err);
  process.exit(1);
});

function handleSignal(signal) {
  console.log(`\n[Paperweight dev] Received ${signal}, shutting down...`);
  app.shutdown();
}

process.on('SIGINT', () => handleSignal('SIGINT'));
process.on('SIGTERM', () => handleSignal('SIGTERM'));
process.on('SIGUSR2', () => handleSignal('SIGUSR2'));
