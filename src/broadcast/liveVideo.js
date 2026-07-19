// Live video broadcast manager — two ingest sources feeding the same HLS
// output: RTMP (external encoder, e.g. OBS) and browser capture (the
// creator's own camera/mic, streamed as chunks over HTTP from the studio
// dashboard). Only one source can be on-air at a time, mirroring the
// mic/RTMP split already used by src/broadcast/live.js for the audio-only
// live feature.
//
// Independent of src/broadcast/live.js (the existing audio-only live feature):
// separate HLS output directory, state file, stream key, and RTMP port, so the
// two features never collide and the existing free live-audio path is never
// touched by this module.
//
// RTMP: FFmpeg itself listens for a single inbound RTMP publish (-listen 1)
// on a local/LAN port and transcodes video+audio to hls_output/live-video/.
// "Started" only means the listener is open; "live" means an encoder has
// actually connected (detected by scanning FFmpeg's stderr for the FLV input
// header).
//
// Browser: the dashboard captures camera+mic via MediaRecorder and POSTs
// fragmented WebM chunks to the server, which pipes them into FFmpeg's
// stdin. There is no "pending" phase for this source — the browser IS the
// encoder, so "live" starts the instant FFmpeg is spawned. A short watchdog
// ends the broadcast if chunks stop arriving (crashed tab, dropped network),
// since there's nothing to auto-reconnect to.
//
// Access to the resulting HLS output is tier-gated at the HTTP layer
// (src/index.js), not here — this module only manages the ffmpeg process.

const net = require('net');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { log } = require('../db');
const { ffmpegPath, installHint } = require('../runtime/ffmpeg');
const { writeJsonAtomic } = require('./stateFile');

const LIVE_DIR = path.join(config.paths.hlsOutput, 'live-video');
const STATE_PATH = path.join(config.paths.hlsOutput, 'live_video_state.json');
const LIVE_KILL_ESCALATE_MS = 2000;
const STDERR_BUFFER_MAX = 64 * 1024;
const STDERR_BUFFER_KEEP = 32 * 1024;
const RTMP_WAIT_TIMEOUT_MS = 10 * 60 * 1000;
const RTMP_CONNECT_RE = /^Input #0, flv/;
const RTMP_PORT_SCAN_RANGE = 10;
const RTMP_MAX_RECONNECT_ATTEMPTS = 5;
const BROWSER_CHUNK_TIMEOUT_MS = 15 * 1000;

// Counts consecutive auto-reconnect attempts that never reached a connected
// encoder — guards against a tight respawn loop if FFmpeg keeps failing
// immediately (bad args, port stolen by another process, etc). Resets to 0
// whenever an encoder actually connects.
let reconnectAttempts = 0;

let state = {
  isLive: false,
  source: null, // 'browser' | 'rtmp' | null
  startedAt: null,
  ffmpegProc: null,
  stdinBackpressured: false,
  pendingDrain: null,
  browserWatchdog: null,

  rtmpPending: false,
  rtmpHost: null,
  rtmpPort: null,
  rtmpWaitTimer: null,
};

function writeLiveState() {
  try {
    writeJsonAtomic(STATE_PATH, {
      isLive: state.isLive,
      source: state.source,
      startedAt: state.startedAt,
      rtmpPending: state.rtmpPending,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    log('error', 'live-video', `Failed to write live_video_state.json: ${err.message}`);
  }
}

function clearRtmpWaitTimer() {
  if (state.rtmpWaitTimer) {
    clearTimeout(state.rtmpWaitTimer);
    state.rtmpWaitTimer = null;
  }
}

function clearBackpressure() {
  state.stdinBackpressured = false;
  state.pendingDrain = null;
}

function clearBrowserWatchdog() {
  if (state.browserWatchdog) {
    clearTimeout(state.browserWatchdog);
    state.browserWatchdog = null;
  }
}

function armBrowserWatchdog() {
  clearBrowserWatchdog();
  state.browserWatchdog = setTimeout(() => {
    log('info', 'live-video', 'No browser video chunk received in time; ending broadcast');
    stopLive();
  }, BROWSER_CHUNK_TIMEOUT_MS);
  state.browserWatchdog.unref?.();
}

function resetBrowserWatchdog() {
  if (state.source === 'browser' && state.isLive) armBrowserWatchdog();
}

function resetState() {
  clearRtmpWaitTimer();
  clearBrowserWatchdog();
  state.isLive = false;
  state.source = null;
  state.startedAt = null;
  state.ffmpegProc = null;
  state.rtmpPending = false;
  state.rtmpHost = null;
  state.rtmpPort = null;
  clearBackpressure();
  writeLiveState();
}

function prepareLiveDir() {
  fs.mkdirSync(LIVE_DIR, { recursive: true });
  // Clear any stale segments from a previous session
  try {
    for (const name of fs.readdirSync(LIVE_DIR)) {
      fs.unlinkSync(path.join(LIVE_DIR, name));
    }
  } catch {}
}

function hlsOutputPaths() {
  return {
    hlsPath: path.join(LIVE_DIR, 'index.m3u8').replace(/\\/g, '/'),
    segPath: path.join(LIVE_DIR, 'seg_%05d.ts').replace(/\\/g, '/'),
  };
}

// ─── RTMP (external encoder) source ───────────────────────────────────────

function buildRtmpArgs({ host, port, streamKey }) {
  const { hlsPath, segPath } = hlsOutputPaths();
  return [
    '-f', 'flv',
    '-listen', '1',
    '-i', `rtmp://${host}:${port}/live/${streamKey}`,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '23',
    '-pix_fmt', 'yuv420p',
    '-g', '60',
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
}

function isConnectSignal(line) {
  return RTMP_CONNECT_RE.test(line.trim());
}

// ─── Browser capture source ───────────────────────────────────────────────

// Reads a live, unbounded, fragmented WebM/Matroska byte stream from stdin
// (a MediaRecorder in the browser POSTing chunks over HTTP) and transcodes
// to the same HLS output shape the RTMP path produces. No -re: the browser
// already paces itself in realtime, so FFmpeg should consume stdin as fast
// as chunks arrive rather than rate-limiting itself.
function buildBrowserArgs() {
  const { hlsPath, segPath } = hlsOutputPaths();
  return [
    '-fflags', '+nobuffer+igndts',
    '-analyzeduration', '2000000',
    '-probesize', '2000000',
    '-f', 'webm',
    '-i', 'pipe:0',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-tune', 'zerolatency',
    '-crf', '23',
    '-pix_fmt', 'yuv420p',
    '-g', '60',
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
}

function startLiveVideoBrowser() {
  if (state.isLive || state.rtmpPending) throw new Error('Already live');

  prepareLiveDir();
  const args = buildBrowserArgs();

  const proc = spawn(ffmpegPath, args, {
    stdio: ['pipe', 'ignore', 'pipe'],
    windowsHide: true,
  });

  attachStderrLogger(proc);

  proc.stdin.on('error', err => {
    log('warn', 'live-video', `FFmpeg stdin error: ${err.message}`);
  });

  attachLifecycleHandlers(proc);

  state.isLive = true;
  state.source = 'browser';
  state.startedAt = new Date().toISOString();
  state.ffmpegProc = proc;
  clearBackpressure();
  armBrowserWatchdog();
  writeLiveState();
  log('info', 'live-video', 'Live video broadcast started (browser)');
  try {
    require('../notify').liveVideoStarted();
  } catch (err) {
    log('warn', 'live-video', `notify.liveVideoStarted failed: ${err.message}`);
  }
}

function pushVideoChunk(buffer) {
  const proc = state.ffmpegProc;
  if (state.source !== 'browser') return { ok: false, wrongSource: true };
  if (!state.isLive || !proc || proc.stdin.destroyed) return { ok: false, inactive: true };
  if (state.stdinBackpressured) return { ok: false, busy: true };
  resetBrowserWatchdog();
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
    log('warn', 'live-video', `Video write error: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

// Finds a free TCP port starting at startPort by probing bind/close cycles.
function findFreeRtmpPort(startPort, host) {
  return new Promise((resolve, reject) => {
    let attempt = 0;

    function tryPort(port) {
      const probe = net.createServer();
      probe.unref();
      probe.once('error', err => {
        if (err.code === 'EADDRINUSE' && attempt < RTMP_PORT_SCAN_RANGE) {
          attempt++;
          tryPort(port + 1);
        } else {
          reject(err);
        }
      });
      probe.listen(port, host, () => {
        probe.close(() => resolve(port));
      });
    }

    tryPort(startPort);
  });
}

function attachStderrLogger(proc, onLine) {
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
      if (!l) continue;
      if (/error|invalid|failed/i.test(l)) log('error', 'live-video', l);
      if (onLine) onLine(l);
    }
  });
}

function attachLifecycleHandlers(proc) {
  proc.on('error', err => {
    const message = err.code === 'ENOENT'
      ? `FFmpeg spawn error: ffmpeg not found. ${installHint()}`
      : `FFmpeg spawn error: ${err.message}`;
    log('error', 'live-video', message);
    if (state.ffmpegProc === proc) resetState();
  });

  proc.on('close', code => {
    log('info', 'live-video', `FFmpeg exited (code ${code})`);
    if (state.ffmpegProc !== proc) return;

    const wasRtmp = state.source === 'rtmp';
    const intentional = proc.paperweightIntentionalExit === true;
    if (wasRtmp && !intentional) {
      if (reconnectAttempts >= RTMP_MAX_RECONNECT_ATTEMPTS) {
        log('error', 'live-video', 'RTMP listener failed repeatedly; giving up automatic reconnect');
        reconnectAttempts = 0;
        resetState();
        return;
      }
      reconnectAttempts++;
      log('info', 'live-video', 'RTMP encoder disconnected; re-listening for reconnect');
      const host = state.rtmpHost;
      const port = state.rtmpPort;
      resetState();
      startLiveVideoRtmp({ host, port }).catch(err => {
        log('error', 'live-video', `Failed to re-listen for RTMP reconnect: ${err.message}`);
      });
      return;
    }

    // Browser-sourced processes never auto-reconnect: there's no listener to
    // resume, the client must call start-browser again for a fresh broadcast.
    resetState();
  });
}

let startToken = 0;

async function startLiveVideoRtmp({ host, port } = {}) {
  if (state.isLive || state.rtmpPending) throw new Error('Already live');

  const targetHost = host || config.broadcast.videoRtmpHost;
  const requestedPort = port || config.broadcast.videoRtmpPort;
  const { getSetting, setSetting } = require('../db/settings');
  const streamKey = getVideoStreamKey(getSetting, setSetting);

  // Claim the slot synchronously, before any async work, so a concurrent
  // start/stop request can't land in the gap while we probe for a port.
  const myToken = ++startToken;
  state.isLive = false;
  state.source = 'rtmp';
  state.rtmpPending = true;
  state.rtmpHost = targetHost;
  state.rtmpPort = requestedPort;
  state.ffmpegProc = null;
  writeLiveState();

  const boundPort = await findFreeRtmpPort(requestedPort, targetHost);

  if (startToken !== myToken || !state.rtmpPending) {
    // Superseded by a stop() or another start() while probing for a port.
    return;
  }

  setSetting('live_video_rtmp_port', String(boundPort));

  prepareLiveDir();
  const args = buildRtmpArgs({ host: targetHost, port: boundPort, streamKey });

  const proc = spawn(ffmpegPath, args, {
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  });

  attachStderrLogger(proc, line => {
    if (state.ffmpegProc === proc && state.rtmpPending && isConnectSignal(line)) {
      clearRtmpWaitTimer();
      reconnectAttempts = 0;
      state.rtmpPending = false;
      state.isLive = true;
      state.startedAt = new Date().toISOString();
      writeLiveState();
      log('info', 'live-video', 'RTMP encoder connected — on air');
      try {
        require('../notify').liveVideoStarted();
      } catch (err) {
        log('warn', 'live-video', `notify.liveVideoStarted failed: ${err.message}`);
      }
    }
  });

  attachLifecycleHandlers(proc);

  state.rtmpPort = boundPort;
  state.ffmpegProc = proc;
  clearRtmpWaitTimer();
  state.rtmpWaitTimer = setTimeout(() => {
    if (state.ffmpegProc === proc && state.rtmpPending) {
      log('info', 'live-video', 'RTMP listener timed out waiting for an encoder; closing');
      stopLive();
    }
  }, RTMP_WAIT_TIMEOUT_MS);
  state.rtmpWaitTimer.unref?.();

  writeLiveState();
  log('info', 'live-video', `RTMP listener started on ${targetHost}:${boundPort}, waiting for encoder`);
}

function getVideoStreamKey(getSetting, setSetting) {
  let key = getSetting('live_video_stream_key');
  if (!key) {
    key = require('crypto').randomBytes(12).toString('hex');
    setSetting('live_video_stream_key', key);
  }
  return key;
}

function getRtmpConnectionInfo() {
  const { getSetting, setSetting } = require('../db/settings');
  const streamKey = getVideoStreamKey(getSetting, setSetting);
  const host = state.rtmpHost || config.broadcast.videoRtmpHost;
  const savedPort = getSetting('live_video_rtmp_port');
  const port = state.rtmpPort || (savedPort ? parseInt(savedPort, 10) : config.broadcast.videoRtmpPort);
  return {
    host,
    port,
    streamKey,
    url: `rtmp://${host}:${port}/live`,
  };
}

function regenerateStreamKey() {
  if (state.isLive || state.rtmpPending) {
    throw new Error('Cannot regenerate the stream key while a broadcast is live or pending');
  }
  const { setSetting } = require('../db/settings');
  const key = require('crypto').randomBytes(12).toString('hex');
  setSetting('live_video_stream_key', key);
  return key;
}

// ─── Shared control ────────────────────────────────────────────────────────

function stopLive() {
  if (!state.isLive && !state.rtmpPending) return;
  const proc = state.ffmpegProc;
  clearRtmpWaitTimer();
  clearBrowserWatchdog();
  if (proc) {
    proc.paperweightIntentionalExit = true;
    try { proc.stdin?.end(); } catch {}
    try { proc.kill('SIGTERM'); } catch (err) {
      log('warn', 'live-video', `Could not terminate live-video FFmpeg: ${err.message}`);
    }
    const timer = setTimeout(() => {
      if (proc.exitCode === null && proc.signalCode === null) {
        log('warn', 'live-video', 'Live-video FFmpeg did not exit after stop; forcing SIGKILL');
        try { proc.kill('SIGKILL'); } catch {}
      }
    }, LIVE_KILL_ESCALATE_MS);
    timer.unref?.();
    proc.once('close', () => clearTimeout(timer));
  }
  resetState();
  log('info', 'live-video', 'Live video broadcast stopped');
}

function getLiveVideoState() {
  return {
    isLive: state.isLive,
    source: state.source,
    startedAt: state.startedAt,
    rtmpPending: state.rtmpPending,
    rtmpPort: state.rtmpPort,
  };
}

function isLiveVideo() {
  return state.isLive;
}

module.exports = {
  startLiveVideoRtmp,
  startLiveVideoBrowser,
  pushVideoChunk,
  stopLive,
  getLiveVideoState,
  isLiveVideo,
  getRtmpConnectionInfo,
  regenerateStreamKey,
  _private: { buildRtmpArgs, buildBrowserArgs, isConnectSignal, findFreeRtmpPort },
};
