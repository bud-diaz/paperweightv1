// Live microphone broadcast manager.
//
// The creator's browser captures mic audio as raw s16le PCM (44100Hz mono) and
// POSTs 2-second chunks to /api/dashboard/live/chunk. Each chunk is written to
// FFmpeg's stdin, which outputs HLS segments to hls_output/live/.
//
// When liveActive is true the stream status reports liveActive:true and the
// listener player switches its HLS source to /hls/live/index.m3u8. When live
// ends the player switches back to /hls/stream/index.m3u8.

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { log } = require('../db');
const { ffmpegPath, installHint } = require('../runtime/ffmpeg');
const { writeJsonAtomic } = require('./stateFile');

const LIVE_DIR = path.join(config.paths.hlsOutput, 'live');
const STATE_PATH = path.join(config.paths.hlsOutput, 'live_state.json');
const LIVE_KILL_ESCALATE_MS = 2000;
const STDERR_BUFFER_MAX = 64 * 1024;
const STDERR_BUFFER_KEEP = 32 * 1024;

let state = {
  isLive: false,
  startedAt: null,
  ffmpegProc: null,
  stdinBackpressured: false,
  pendingDrain: null,
};

function writeLiveState() {
  try {
    writeJsonAtomic(STATE_PATH, {
      isLive: state.isLive,
      startedAt: state.startedAt,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    log('error', 'live', `Failed to write live_state.json: ${err.message}`);
  }
}

function clearBackpressure() {
  state.stdinBackpressured = false;
  state.pendingDrain = null;
}

function startLive() {
  if (state.isLive) throw new Error('Already live');

  fs.mkdirSync(LIVE_DIR, { recursive: true });

  // Clear any stale segments from a previous session
  try {
    for (const name of fs.readdirSync(LIVE_DIR)) {
      fs.unlinkSync(path.join(LIVE_DIR, name));
    }
  } catch {}

  const hlsPath = path.join(LIVE_DIR, 'index.m3u8').replace(/\\/g, '/');
  const segPath = path.join(LIVE_DIR, 'seg_%05d.ts').replace(/\\/g, '/');

  // Reads raw 16-bit LE PCM mono 44100Hz from stdin, transcodes to AAC HLS
  const args = [
    '-f', 's16le',
    '-ar', '44100',
    '-ac', '1',
    '-i', 'pipe:0',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-ac', '2',
    '-ar', '44100',
    '-f', 'hls',
    '-hls_time', '3',
    '-hls_list_size', '6',
    '-hls_flags', 'delete_segments+append_list',
    '-hls_segment_filename', segPath,
    hlsPath,
  ];

  const proc = spawn(ffmpegPath, args, {
    stdio: ['pipe', 'ignore', 'pipe'],
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
      if (l && /error|invalid|failed/i.test(l)) log('error', 'live', l);
    }
  });

  proc.stdin.on('error', err => {
    log('warn', 'live', `FFmpeg stdin error: ${err.message}`);
  });

  proc.on('error', err => {
    const message = err.code === 'ENOENT'
      ? `FFmpeg spawn error: ffmpeg not found. ${installHint()}`
      : `FFmpeg spawn error: ${err.message}`;
    log('error', 'live', message);
    if (state.ffmpegProc === proc) {
      state.isLive = false;
      state.startedAt = null;
      state.ffmpegProc = null;
      clearBackpressure();
      writeLiveState();
    }
  });

  proc.on('close', code => {
    log('info', 'live', `FFmpeg exited (code ${code})`);
    if (state.ffmpegProc === proc) {
      state.isLive = false;
      state.startedAt = null;
      state.ffmpegProc = null;
      clearBackpressure();
      writeLiveState();
    }
  });

  state.isLive = true;
  state.startedAt = new Date().toISOString();
  state.ffmpegProc = proc;
  clearBackpressure();
  writeLiveState();
  log('info', 'live', 'Live broadcast started');
}

function pushAudio(buffer) {
  const proc = state.ffmpegProc;
  if (!state.isLive || !proc || proc.stdin.destroyed) return { ok: false, inactive: true };
  if (state.stdinBackpressured) return { ok: false, busy: true };
  try {
    const accepted = proc.stdin.write(buffer);
    if (accepted) return { ok: true, backpressure: false };
    state.stdinBackpressured = true;
    state.pendingDrain = new Promise(resolve => {
      const done = () => {
        if (state.ffmpegProc === proc) clearBackpressure();
        resolve({ ok: true, backpressure: true });
      };
      proc.stdin.once('drain', done);
      proc.once('close', done);
    });
    return state.pendingDrain;
  } catch (err) {
    log('warn', 'live', `Audio write error: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

function stopLive() {
  if (!state.isLive) return;
  const proc = state.ffmpegProc;
  if (proc) {
    proc.paperweightIntentionalExit = true;
    try { proc.stdin.end(); } catch {}
    try { proc.kill('SIGTERM'); } catch (err) {
      log('warn', 'live', `Could not terminate live FFmpeg: ${err.message}`);
    }
    const timer = setTimeout(() => {
      if (proc.exitCode === null && proc.signalCode === null) {
        log('warn', 'live', 'Live FFmpeg did not exit after stop; forcing SIGKILL');
        try { proc.kill('SIGKILL'); } catch {}
      }
    }, LIVE_KILL_ESCALATE_MS);
    timer.unref?.();
    proc.once('close', () => clearTimeout(timer));
  }
  state.isLive = false;
  state.startedAt = null;
  state.ffmpegProc = null;
  clearBackpressure();
  writeLiveState();
  log('info', 'live', 'Live broadcast stopped');
}

function getLiveState() {
  return { isLive: state.isLive, startedAt: state.startedAt };
}

function isLive() {
  return state.isLive;
}

module.exports = { startLive, pushAudio, stopLive, getLiveState, isLive };
