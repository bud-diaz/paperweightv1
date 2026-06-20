const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { log, getDb } = require('../db');
const { buildShuffleBatch, buildSequentialBatch, homogenizeBatch, isVideoTrack } = require('./playlist');
const { resolveCurrentBlock } = require('./scheduler');
const { writeConcatManifest } = require('./concat');
const { ffmpegPath, installHint } = require('../runtime/ffmpeg');
const { writeJsonAtomic } = require('./stateFile');

const STATE_PATH = path.join(config.paths.hlsOutput, 'state.json');
const HLS_STREAM_DIR = path.join(config.paths.hlsOutput, 'stream');
const FFMPEG_BACKOFF_INITIAL_MS = 3000;
const FFMPEG_BACKOFF_MAX_MS = 60000;
const FFMPEG_KILL_ESCALATE_MS = 5000;
const STDERR_BUFFER_MAX = 64 * 1024;
const STDERR_BUFFER_KEEP = 32 * 1024;

// ─── Station queue (in-memory, max 5 track IDs) ──────────────────────────────
let stationQueue = [];

function getStationQueue() { return [...stationQueue]; }

function addToStationQueue(mediaId) {
  if (stationQueue.length >= 5) return false;
  stationQueue.push(mediaId);
  return true;
}

function removeFromStationQueue(idx) {
  if (idx >= 0 && idx < stationQueue.length) {
    stationQueue.splice(idx, 1);
  }
}

// ─── Engine state (in-process) ───────────────────────────────────────────────
let state = {
  isRunning: false,
  mode: 'shuffle',           // 'shuffle' | 'scheduled'
  ffmpegProc: null,
  currentBatch: [],
  batchStartedAt: null,
  nowPlayingIndex: 0,
  trackOffsets: [],          // cumulative seconds: [0, d0, d0+d1, ...]
  segmentCounter: 0,         // global HLS segment counter, never resets
  nowPlayingTimer: null,
  recentlyPlayed: [],        // last 10 finished tracks, newest first
};

// ─── State file ──────────────────────────────────────────────────────────────

function writeStateFile(overrides = {}) {
  const track = state.currentBatch[state.nowPlayingIndex] || null;
  const trackStart = track && state.batchStartedAt
    ? new Date(state.batchStartedAt.getTime() + (state.trackOffsets[state.nowPlayingIndex] || 0) * 1000)
    : null;

  const hasVideo = state.currentBatch.some(t => isVideoTrack(t));

  const payload = {
    isLive: state.isRunning,
    mode: state.mode,
    isVideo: hasVideo,
    recentlyPlayed: state.recentlyPlayed,
    nowPlaying: track ? {
      id: track.id,
      title: track.title || path.basename(track.filepath),
      artist: track.artist || null,
      category: track.category || null,
      duration: track.duration || null,
      isVideo: isVideoTrack(track),
      startedAt: trackStart ? trackStart.toISOString() : null,
    } : null,
    updatedAt: new Date().toISOString(),
    ...overrides,
  };

  try {
    writeJsonAtomic(STATE_PATH, payload);
  } catch (err) {
    log('error', 'broadcast', `Failed to write state.json: ${err.message}`);
  }
}

// ─── Now-playing tracker ─────────────────────────────────────────────────────

function pushRecentlyPlayed(track) {
  if (!track) return;
  state.recentlyPlayed.unshift({
    id: track.id,
    title: track.title || path.basename(track.filepath),
    artist: track.artist || null,
    category: track.category || null,
    playedAt: new Date().toISOString(),
  });
  if (state.recentlyPlayed.length > 10) state.recentlyPlayed.pop();
}

function updateNowPlaying() {
  if (!state.batchStartedAt || !state.currentBatch.length) return;

  const elapsedSec = (Date.now() - state.batchStartedAt.getTime()) / 1000;
  const offsets = state.trackOffsets;

  // Find the last offset that elapsed time has passed
  let idx = 0;
  for (let i = offsets.length - 1; i >= 0; i--) {
    if (elapsedSec >= offsets[i]) {
      idx = i;
      break;
    }
  }

  // Record any tracks we advanced past as recently played
  if (idx > state.nowPlayingIndex) {
    for (let i = state.nowPlayingIndex; i < idx; i++) {
      pushRecentlyPlayed(state.currentBatch[i]);
    }
  }

  state.nowPlayingIndex = idx;
  writeStateFile();
}

function buildTrackOffsets(batch) {
  const offsets = [0];
  let cumulative = 0;
  for (let i = 0; i < batch.length - 1; i++) {
    cumulative += batch[i].duration || 0;
    offsets.push(cumulative);
  }
  return offsets;
}

// Cached result of the last directory scan. Invalidated whenever a new batch
// of segments is about to be written (runFFmpeg) or the HLS dir is reset
// (cleanHlsStreamDir), so repeated calls within the same batch avoid rescanning.
let cachedSegmentNumber = null;

function invalidateSegmentCache() {
  cachedSegmentNumber = null;
}

function nextSegmentNumber() {
  if (cachedSegmentNumber !== null) {
    return Math.max(state.segmentCounter, cachedSegmentNumber, 0);
  }

  let maxSeen = -1;
  try {
    if (fs.existsSync(HLS_STREAM_DIR)) {
      for (const name of fs.readdirSync(HLS_STREAM_DIR)) {
        const match = name.match(/^seg_(\d+)\.ts$/);
        if (match) maxSeen = Math.max(maxSeen, parseInt(match[1], 10));
      }
    }
  } catch (err) {
    log('warn', 'broadcast', `Could not inspect HLS segment numbers: ${err.message}`);
  }
  cachedSegmentNumber = Math.max(state.segmentCounter, maxSeen + 1, 0);
  return cachedSegmentNumber;
}

// ─── Batch resolution ────────────────────────────────────────────────────────

function resolveBatch() {
  // Station queue takes priority — play one queued track at a time
  if (stationQueue.length > 0) {
    const trackId = stationQueue.shift();
    try {
      const track = getDb().prepare('SELECT * FROM media WHERE id = ? AND is_active = 1').get(trackId);
      if (track) {
        const tracks = homogenizeBatch([track]);
        if (tracks.length > 0) return { tracks, source: `queue:${trackId}` };
      }
    } catch {}
  }

  if (state.mode === 'scheduled') {
    const block = resolveCurrentBlock();
    if (block) {
      const raw = block.mode === 'sequential'
        ? buildSequentialBatch({ blockId: block.id })
        : buildShuffleBatch({ category: block.category || null });
      const tracks = homogenizeBatch(raw);
      if (tracks.length > 0) return { tracks, source: `block:${block.id}` };
      log('warn', 'broadcast', `Block ${block.id} resolved to empty — falling back to global shuffle`);
    }
    // No active block — fall through to global shuffle
  }
  const tracks = homogenizeBatch(buildShuffleBatch());
  return { tracks, source: 'shuffle' };
}

// ─── FFmpeg ──────────────────────────────────────────────────────────────────

function buildFFmpegArgs(concatPath, hasVideo = false) {
  const startNumber = nextSegmentNumber();
  state.segmentCounter = startNumber;

  const videoArgs = hasVideo
    ? [
        '-c:v', 'libx264',
        '-crf', '28',
        '-preset', 'veryfast',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-ac', '2',
        '-ar', '44100',
      ]
    : [
        // Audio-only output — minimal CPU load
        '-vn',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-ac', '2',
        '-ar', '44100',
      ];

  return [
    '-re',
    '-f', 'concat',
    '-safe', '0',
    '-i', concatPath,
    ...videoArgs,
    // HLS output
    '-f', 'hls',
    '-hls_time', '6',
    '-hls_list_size', '10',
    '-hls_flags', 'delete_segments+append_list',
    '-start_number', String(startNumber),
    '-hls_segment_filename', path.join(HLS_STREAM_DIR, 'seg_%05d.ts').replace(/\\/g, '/'),
    path.join(HLS_STREAM_DIR, 'index.m3u8').replace(/\\/g, '/'),
  ];
}

function runFFmpeg(batch) {
  return new Promise((resolve, reject) => {
    // The track playing at the end of the previous batch is now finished
    if (state.currentBatch.length > 0) {
      pushRecentlyPlayed(state.currentBatch[state.nowPlayingIndex]);
    }

    const hasVideo = batch.some(t => isVideoTrack(t));
    const concatPath = writeConcatManifest(batch);
    const args = buildFFmpegArgs(concatPath, hasVideo);
    invalidateSegmentCache();

    const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    state.ffmpegProc = proc;
    state.currentBatch = batch;
    state.batchStartedAt = new Date();
    state.nowPlayingIndex = 0;
    state.trackOffsets = buildTrackOffsets(batch);

    // Start now-playing ticker (every 5s)
    if (state.nowPlayingTimer) clearInterval(state.nowPlayingTimer);
    state.nowPlayingTimer = setInterval(updateNowPlaying, 5000);
    updateNowPlaying(); // immediate write

    // Guard: error + close both fire on spawn failure — only settle once
    let settled = false;
    function settle(fn, val) {
      if (settled) return;
      settled = true;
      clearInterval(state.nowPlayingTimer);
      state.nowPlayingTimer = null;
      if (state.ffmpegProc === proc) state.ffmpegProc = null;
      fn(val);
    }

    // Collect FFmpeg stderr but only surface errors
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
        if (/error|invalid|failed|no such/i.test(l)) {
          log('error', 'broadcast', l);
        }
      }
    });

    proc.on('error', err => {
      if (err.code === 'ENOENT') {
        settle(reject, new Error(`ffmpeg not found. ${installHint()}`));
      } else {
        settle(reject, err);
      }
    });

    proc.on('close', (code, signal) => {
      state.segmentCounter = nextSegmentNumber();

      if (code === 0 || proc.paperweightIntentionalExit) {
        settle(resolve, { code, signal });
        return;
      }

      const err = new Error(
        code === null || code === undefined
          ? `ffmpeg exited by signal ${signal || 'unknown'}`
          : `ffmpeg exited with code ${code}`
      );
      err.exitCode = code;
      err.signal = signal;
      settle(reject, err);
    });
  });
}

// ─── Main loop ───────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function cleanHlsStreamDir() {
  const parentDir = path.dirname(HLS_STREAM_DIR);
  const suffix = `${Date.now()}-${process.pid}`;
  const freshDir = path.join(parentDir, `stream.new-${suffix}`);
  const gcDir = path.join(parentDir, `stream.gc-${suffix}`);
  try {
    fs.mkdirSync(parentDir, { recursive: true });
    fs.mkdirSync(freshDir, { recursive: true });
    if (fs.existsSync(HLS_STREAM_DIR)) {
      fs.renameSync(HLS_STREAM_DIR, gcDir);
    }
    fs.renameSync(freshDir, HLS_STREAM_DIR);
    state.segmentCounter = 0;
    invalidateSegmentCache();
    if (fs.existsSync(gcDir)) {
      fs.rm(gcDir, { recursive: true, force: true }, err => {
        if (err) log('warn', 'broadcast', `Could not remove stale HLS directory: ${err.message}`);
      });
    }
  } catch (err) {
    log('warn', 'broadcast', `Could not clean stale HLS files: ${err.message}`);
    try { fs.rmSync(freshDir, { recursive: true, force: true }); } catch {}
    try { fs.mkdirSync(HLS_STREAM_DIR, { recursive: true }); } catch {}
  }
}

function terminateFFmpegProc(proc, reason) {
  if (!proc) return;
  proc.paperweightIntentionalExit = true;
  try {
    proc.kill('SIGTERM');
  } catch (err) {
    log('warn', 'broadcast', `Could not terminate FFmpeg for ${reason}: ${err.message}`);
    return;
  }

  const timer = setTimeout(() => {
    if (proc.exitCode === null && proc.signalCode === null) {
      log('warn', 'broadcast', `FFmpeg did not exit after ${reason}; forcing SIGKILL`);
      try { proc.kill('SIGKILL'); } catch {}
    }
  }, FFMPEG_KILL_ESCALATE_MS);
  timer.unref?.();
  proc.once('close', () => clearTimeout(timer));
}

async function broadcastLoop() {
  let ffmpegBackoffMs = FFMPEG_BACKOFF_INITIAL_MS;

  while (state.isRunning) {
    let batch, source;

    try {
      ({ tracks: batch, source } = resolveBatch());
    } catch (err) {
      log('error', 'broadcast', `Batch resolution failed: ${err.message}`);
      await sleep(5000);
      continue;
    }

    if (!batch || batch.length === 0) {
      log('warn', 'broadcast', 'Vault has no playable media — waiting...');
      writeStateFile({ nowPlaying: null });
      await sleep(10000);
      continue;
    }

    log('info', 'broadcast', `Batch ready [${source}]: ${batch.length} tracks`);

    // In scheduled mode, poll every 30 s and cut the batch if the active block changes.
    let schedWatcher = null;
    if (state.mode === 'scheduled') {
      const batchSource = source;
      schedWatcher = setInterval(() => {
        if (!state.isRunning || state.mode !== 'scheduled' || !state.ffmpegProc) return;
        const active = resolveCurrentBlock();
        const activeSource = active ? `block:${active.id}` : 'shuffle';
        if (activeSource !== batchSource) {
          log('info', 'broadcast', `Schedule changed (${batchSource} → ${activeSource}); cutting batch`);
          terminateFFmpegProc(state.ffmpegProc, 'schedule change');
        }
      }, 30 * 1000);
    }

    try {
      await runFFmpeg(batch);
      ffmpegBackoffMs = FFMPEG_BACKOFF_INITIAL_MS;
    } catch (err) {
      log('error', 'broadcast', `FFmpeg error: ${err.message}`);
      if (err.message.includes('not found')) {
        // FFmpeg not installed — stop the loop, don't spam logs
        state.isRunning = false;
        break;
      }
      const delay = ffmpegBackoffMs;
      ffmpegBackoffMs = Math.min(ffmpegBackoffMs * 2, FFMPEG_BACKOFF_MAX_MS);
      log('warn', 'broadcast', `Retrying FFmpeg in ${Math.round(delay / 1000)}s`);
      await sleep(delay);
    } finally {
      if (schedWatcher) clearInterval(schedWatcher);
    }
  }

  writeStateFile({ isLive: false, nowPlaying: null });
  log('info', 'broadcast', 'Broadcast stopped');
}

// ─── Public API ──────────────────────────────────────────────────────────────

function start(mode = 'shuffle') {
  if (state.isRunning) {
    log('warn', 'broadcast', 'Already running');
    return;
  }
  // Ensure HLS output dirs exist. The installer (setup.sh) creates these, but a
  // standalone exe launched in a fresh directory must create them itself or
  // ffmpeg's segment writes and state.json fail. recursive covers the parent.
  fs.mkdirSync(HLS_STREAM_DIR, { recursive: true });
  cleanHlsStreamDir();
  state.isRunning = true;
  state.mode = mode;
  log('info', 'broadcast', `Broadcast starting in ${mode} mode`);

  broadcastLoop().catch(err => {
    log('error', 'broadcast', `Loop crashed: ${err.message}`);
    state.isRunning = false;
    writeStateFile({ isLive: false });
  });
}

function stop() {
  state.isRunning = false;
  if (state.nowPlayingTimer) {
    clearInterval(state.nowPlayingTimer);
    state.nowPlayingTimer = null;
  }
  if (state.ffmpegProc) {
    terminateFFmpegProc(state.ffmpegProc, 'stop');
  }
  writeStateFile({ isLive: false, nowPlaying: null });
  log('info', 'broadcast', 'Broadcast stop requested');
}

function setMode(mode) {
  if (mode !== 'shuffle' && mode !== 'scheduled') {
    throw new Error(`Invalid mode: ${mode}`);
  }
  state.mode = mode;
  log('info', 'broadcast', `Mode changed to: ${mode}`);
  // Kill current FFmpeg batch so the loop picks up the new mode immediately
  if (state.isRunning && state.ffmpegProc) {
    terminateFFmpegProc(state.ffmpegProc, 'mode change');
  }
}

function getState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return { isLive: false, mode: state.mode, nowPlaying: null };
  }
}

function isRunning() {
  return state.isRunning;
}

module.exports = { start, stop, setMode, getState, isRunning, cleanHlsStreamDir, getStationQueue, addToStationQueue, removeFromStationQueue };
