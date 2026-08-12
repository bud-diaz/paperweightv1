'use strict';

const { spawn } = require('child_process');
const { log } = require('../db');
const { frpcPath, installHint } = require('./frp');

const KILL_ESCALATE_MS = 2000;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_DELAY_MS = 2000;
const CONNECTED_RE = /start proxy success|login to server success|work connection registered|proxy .* started/i;

function createFrpSupervisor({ spawnImpl = spawn, frpcPath: resolvedFrpcPath = frpcPath, logImpl = log } = {}) {
  const state = {
    proc: null,
    configPath: null,
    status: 'stopped',
    lastError: null,
    reconnectAttempts: 0,
    reconnectTimer: null,
    stopping: false,
  };

  function writeLog(level, message) {
    try { logImpl(level, 'tunnel', message); } catch {}
  }

  function clearReconnectTimer() {
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }
  }

  function scheduleReconnect() {
    if (state.stopping || !state.configPath) return;
    if (state.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      state.status = 'error';
      state.lastError = `frpc failed to stay connected after ${MAX_RECONNECT_ATTEMPTS} attempts.`;
      writeLog('error', state.lastError);
      return;
    }
    state.reconnectAttempts += 1;
    const delay = RECONNECT_BASE_DELAY_MS * state.reconnectAttempts;
    clearReconnectTimer();
    state.reconnectTimer = setTimeout(() => spawnTunnel(state.configPath), delay);
    if (typeof state.reconnectTimer.unref === 'function') state.reconnectTimer.unref();
  }

  function spawnTunnel(configPath) {
    if (state.stopping) return;
    state.status = 'connecting';
    state.lastError = null;

    const proc = spawnImpl(resolvedFrpcPath, ['-c', configPath], {
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
        writeLog('info', 'frpc tunnel connected');
      }
    }

    if (proc.stdout && proc.stdout.on) proc.stdout.on('data', scanForConnected);
    if (proc.stderr && proc.stderr.on) proc.stderr.on('data', scanForConnected);

    proc.on('error', err => {
      if (state.proc !== proc) return;
      state.proc = null;
      state.lastError = err.code === 'ENOENT' ? `frpc not found. ${installHint()}` : err.message;
      state.status = 'error';
      writeLog('error', `frpc spawn error: ${state.lastError}`);
      scheduleReconnect();
    });

    proc.on('close', (code, signal) => {
      if (state.proc !== proc) return;
      state.proc = null;
      if (state.stopping || proc.paperweightIntentionalExit) {
        state.status = 'stopped';
        return;
      }
      state.lastError = `frpc exited unexpectedly (code ${code}, signal ${signal})`;
      state.status = 'error';
      writeLog('warn', state.lastError);
      scheduleReconnect();
    });
  }

  function start(configPath) {
    if (!configPath || typeof configPath !== 'string' || !configPath.trim()) {
      throw new Error('start(configPath) requires a non-empty frpc config path');
    }
    stop();
    state.stopping = false;
    state.configPath = configPath.trim();
    state.reconnectAttempts = 0;
    spawnTunnel(state.configPath);
  }

  function stop() {
    clearReconnectTimer();
    state.stopping = true;
    state.configPath = null;
    const proc = state.proc;
    if (!proc) {
      state.status = 'stopped';
      return;
    }
    proc.paperweightIntentionalExit = true;
    proc.kill('SIGTERM');
    const timer = setTimeout(() => {
      if (state.proc === proc) {
        try { proc.kill('SIGKILL'); } catch {}
      }
    }, KILL_ESCALATE_MS);
    if (typeof timer.unref === 'function') timer.unref();
    state.status = 'stopped';
  }

  function getStatus() {
    return {
      provider: 'frp',
      status: state.status,
      lastError: state.lastError,
      reconnectAttempts: state.reconnectAttempts,
      running: !!state.proc,
    };
  }

  return { start, stop, getStatus };
}

const defaultSupervisor = createFrpSupervisor();
module.exports = { ...defaultSupervisor, createFrpSupervisor };
