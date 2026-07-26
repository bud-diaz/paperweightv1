'use strict';

// Supervises a `cloudflared tunnel run` child process so the dashboard's
// "auto-create tunnel" flow (src/api/dashboard.js's auto-tunnel route) can
// bring a public URL online immediately, without the owner ever opening a
// terminal to run `cloudflared service install <token>` by hand. Mirrors the
// broadcast engine's process-supervision conventions (src/broadcast/live.js):
// a small state object holding the child process, a kill-escalation timeout,
// and a capped reconnect-attempt counter to avoid a tight respawn loop if
// cloudflared keeps failing immediately (bad token, network down, etc).

const { spawn } = require('child_process');
const { log } = require('../db');
const { cloudflaredPath, installHint } = require('./cloudflared');

const KILL_ESCALATE_MS = 2000;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_DELAY_MS = 2000;
const CONNECTED_RE = /Registered tunnel connection|Connection .* registered/i;

const state = {
  proc: null,
  token: null,
  status: 'stopped', // 'stopped' | 'connecting' | 'connected' | 'error'
  lastError: null,
  reconnectAttempts: 0,
  reconnectTimer: null,
  stopping: false,
};

function clearReconnectTimer() {
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }
}

function scheduleReconnect() {
  if (state.stopping || !state.token) return;
  if (state.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    state.status = 'error';
    state.lastError = `cloudflared failed to stay connected after ${MAX_RECONNECT_ATTEMPTS} attempts.`;
    log('error', 'tunnel', state.lastError);
    return;
  }
  state.reconnectAttempts += 1;
  const delay = RECONNECT_BASE_DELAY_MS * state.reconnectAttempts;
  clearReconnectTimer();
  // unref() so a pending backoff retry (e.g. cloudflared missing/misconfigured)
  // never keeps the Node process alive on its own — matches stop()'s kill-
  // escalation timer below and prevents this from stalling process exit
  // (including in tests, which don't call stop() after exercising this route).
  state.reconnectTimer = setTimeout(() => spawnTunnel(state.token), delay).unref();
}

function spawnTunnel(token) {
  if (state.stopping) return;
  state.status = 'connecting';
  state.lastError = null;

  const proc = spawn(cloudflaredPath, ['tunnel', 'run', '--token', token], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  state.proc = proc;

  let outputBuf = '';
  function scanForConnected(chunk) {
    outputBuf += chunk.toString();
    if (outputBuf.length > 8192) outputBuf = outputBuf.slice(-4096);
    if (state.status !== 'connected' && CONNECTED_RE.test(outputBuf)) {
      state.status = 'connected';
      state.reconnectAttempts = 0;
      log('info', 'tunnel', 'cloudflared tunnel connected');
    }
  }
  proc.stdout.on('data', scanForConnected);
  proc.stderr.on('data', scanForConnected); // cloudflared logs to stderr by default

  proc.on('error', err => {
    if (state.proc !== proc) return;
    state.proc = null;
    state.lastError = err.code === 'ENOENT' ? `cloudflared not found. ${installHint()}` : err.message;
    state.status = 'error';
    log('error', 'tunnel', `cloudflared spawn error: ${state.lastError}`);
    scheduleReconnect();
  });

  proc.on('close', (code, signal) => {
    if (state.proc !== proc) return; // already superseded by a new spawn
    state.proc = null;
    if (state.stopping || proc.paperweightIntentionalExit) {
      state.status = 'stopped';
      return;
    }
    state.lastError = `cloudflared exited unexpectedly (code ${code}, signal ${signal})`;
    state.status = 'error';
    log('warn', 'tunnel', state.lastError);
    scheduleReconnect();
  });
}

function start(token) {
  if (!token || typeof token !== 'string' || !token.trim()) {
    throw new Error('start(token) requires a non-empty tunnel token');
  }
  stop(); // supersede any previous supervised process (e.g. a rotated token)
  state.stopping = false;
  state.token = token.trim();
  state.reconnectAttempts = 0;
  spawnTunnel(state.token);
}

function stop() {
  clearReconnectTimer();
  state.stopping = true;
  state.token = null;
  const proc = state.proc;
  if (!proc) {
    state.status = 'stopped';
    return;
  }
  proc.paperweightIntentionalExit = true;
  proc.kill('SIGTERM');
  setTimeout(() => {
    if (state.proc === proc) {
      try { proc.kill('SIGKILL'); } catch { /* already gone */ }
    }
  }, KILL_ESCALATE_MS).unref();
  state.status = 'stopped';
}

function getStatus() {
  return {
    status: state.status,
    lastError: state.lastError,
    reconnectAttempts: state.reconnectAttempts,
    running: !!state.proc,
  };
}

module.exports = { start, stop, getStatus };
