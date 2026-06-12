// Manages the optional asciline ASCII-art streaming server.
//
// Asciline converts video to real-time ASCII art and streams frames over
// WebSockets to a browser Canvas renderer. When ASCILINE_ENABLED=true,
// this module spawns the asciline stream_server.py pointed at the vault.
//
// One-time setup (user-performed before enabling):
//   git clone https://github.com/yusufb5/asciline <ASCILINE_PATH>
//   pip install fastapi uvicorn opencv-python numpy websockets
//   Set ASCILINE_ENABLED=true and ASCILINE_PATH=/path/to/asciline in .env

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { log } = require('../db');

const KILL_ESCALATE_MS = 2000;
const STDERR_BUFFER_MAX = 64 * 1024;
const STDERR_BUFFER_KEEP = 32 * 1024;

let state = {
  proc: null,
  running: false,
  startedAt: null,
};

function spawnProcess() {
  const { path: ascilinePath, port, mode, cols } = config.asciline;
  const vaultPath = config.vault.path;

  const args = [
    path.join(ascilinePath, 'stream_server.py'),
    '--folder', vaultPath,
    '--port', String(port),
    '--mode', mode,
    '--cols', String(cols),
  ];

  const proc = spawn('python3', args, {
    cwd: ascilinePath,
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  });

  let stderrBuf = '';
  proc.stderr.on('data', chunk => {
    stderrBuf += chunk.toString();
    if (stderrBuf.length > STDERR_BUFFER_MAX) {
      stderrBuf = stderrBuf.slice(-STDERR_BUFFER_KEEP);
    }
    const lines = stderrBuf.split('\n');
    stderrBuf = lines.pop();
    if (stderrBuf.length > STDERR_BUFFER_KEEP) {
      stderrBuf = stderrBuf.slice(-STDERR_BUFFER_KEEP);
    }
    for (const line of lines) {
      const l = line.trim();
      if (l && /error|failed|traceback/i.test(l)) log('error', 'asciline', l);
    }
  });

  proc.on('error', err => {
    const message = err.code === 'ENOENT'
      ? 'asciline spawn error: python3 not found. Install Python 3 to use ASCII mode.'
      : `asciline spawn error: ${err.message}`;
    log('error', 'asciline', message);
    if (state.proc === proc) {
      state.proc = null;
      state.running = false;
      state.startedAt = null;
    }
  });

  proc.on('close', code => {
    if (!proc.ascilineIntentionalExit) {
      log('warn', 'asciline', `exited unexpectedly (code ${code})`);
    }
    if (state.proc === proc) {
      state.proc = null;
      state.running = false;
      state.startedAt = null;
    }
  });

  state.proc = proc;
  state.running = true;
  state.startedAt = new Date().toISOString();
  log('info', 'asciline', `started on port ${port} (vault: ${vaultPath})`);
}

function start() {
  if (!config.asciline.enabled) return;
  if (state.running) return;

  if (!config.asciline.path) {
    log('warn', 'asciline', 'ASCILINE_PATH not set; ASCII mode disabled');
    return;
  }

  const scriptPath = path.join(config.asciline.path, 'stream_server.py');
  if (!fs.existsSync(scriptPath)) {
    log('warn', 'asciline', `stream_server.py not found at ${scriptPath}; ASCII mode disabled`);
    return;
  }

  spawnProcess();
}

function stop() {
  const proc = state.proc;
  if (!proc) return;

  proc.ascilineIntentionalExit = true;
  try { proc.kill('SIGTERM'); } catch (err) {
    log('warn', 'asciline', `could not terminate: ${err.message}`);
  }

  const timer = setTimeout(() => {
    if (proc.exitCode === null && proc.signalCode === null) {
      log('warn', 'asciline', 'did not exit after SIGTERM; forcing SIGKILL');
      try { proc.kill('SIGKILL'); } catch {}
    }
  }, KILL_ESCALATE_MS);
  timer.unref?.();
  proc.once('close', () => clearTimeout(timer));

  state.proc = null;
  state.running = false;
  state.startedAt = null;
  log('info', 'asciline', 'stopped');
}

function getStatus() {
  return {
    enabled:   config.asciline.enabled,
    running:   state.running,
    port:      config.asciline.port,
    mode:      config.asciline.mode,
    startedAt: state.startedAt,
  };
}

module.exports = { start, stop, getStatus };
