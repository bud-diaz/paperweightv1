const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { log } = require('../db');
const { buildShuffleBatch, buildSequentialBatch } = require('./playlist');
const { resolveCurrentBlock } = require('./scheduler');
const { writeConcatManifest } = require('./concat');

const STATE_PATH = path.join(config.paths.hlsOutput, 'state.json');
const HLS_STREAM_DIR = path.join(config.paths.hlsOutput, 'stream');

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
};

// ─── State file ──────────────────────────────────────────────────────────────

function writeStateFile(overrides = {}) {
  const track = state.currentBatch[state.nowPlayingIndex] || null;
  const trackStart = track && state.batchStartedAt
    ? new Date(state.batchStartedAt.getTime() + (state.trackOffsets[state.nowPlayingIndex] || 0) * 1000)
    : null;

  const payload = {
    isLive: state.isRunning,
    mode: state.mode,
    nowPlaying: track ? {
      id: track.id,
      title: track.title || path.basename(track.filepath),
      artist: track.artist || null,
      category: track.category || null,
      duration: track.duration || null,
      startedAt: trackStart ? trackStart.toISOString() : null,
    } : null,
    updatedAt: new Date().toISOString(),
    ...overrides,
  };

  try {
    fs.writeFileSync(STATE_PATH, JSON.stringify(payload, null, 2), 'utf8');
  } catch (err) {
    log('error', 'broadcast', `Failed to write state.json: ${err.message}`);
  }
}

// ─── Now-playing tracker ─────────────────────────────────────────────────────

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

// ─── Batch resolution ────────────────────────────────────────────────────────

function resolveBatch() {
  if (state.mode === 'scheduled') {
    const block = resolveCurrentBlock();
    if (block) {
      const tracks = block.mode === 'sequential'
        ? buildSequentialBatch({ blockId: block.id })
        : buildShuffleBatch({ category: block.category || null });
      if (tracks.length > 0) return { tracks, source: `block:${block.id}` };
    }
    // No active block — fall through to global shuffle
  }
  const tracks = buildShuffleBatch();
  return { tracks, source: 'shuffle' };
}

// ─── FFmpeg ──────────────────────────────────────────────────────────────────

function buildFFmpegArgs(concatPath) {
  return [
    '-re',
    '-f', 'concat',
    '-safe', '0',
    '-i', concatPath,
    // Audio output only (strip video — keeps Pi CPU load minimal)
    '-vn',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-ac', '2',
    '-ar', '44100',
    // HLS output
    '-f', 'hls',
    '-hls_time', '6',
    '-hls_list_size', '10',
    '-hls_flags', 'delete_segments+append_list',
    '-start_number', String(state.segmentCounter),
    '-hls_segment_filename', path.join(HLS_STREAM_DIR, 'seg_%05d.ts').replace(/\\/g, '/'),
    path.join(HLS_STREAM_DIR, 'index.m3u8').replace(/\\/g, '/'),
  ];
}

function runFFmpeg(batch) {
  return new Promise((resolve, reject) => {
    const concatPath = writeConcatManifest(batch);
    const args = buildFFmpegArgs(concatPath);

    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
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
      state.ffmpegProc = null;
      fn(val);
    }

    // Collect FFmpeg stderr but only surface errors
    let stderrBuf = '';
    proc.stderr.on('data', chunk => {
      stderrBuf += chunk.toString();
      const lines = stderrBuf.split('\n');
      stderrBuf = lines.pop();
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
        settle(reject, new Error('ffmpeg not found — install with: sudo apt install ffmpeg'));
      } else {
        settle(reject, err);
      }
    });

    proc.on('close', code => {
      // Advance global segment counter so the next batch doesn't reuse filenames
      const totalDuration = batch.reduce((sum, t) => sum + (t.duration || 0), 0);
      state.segmentCounter += Math.ceil(totalDuration / 6) + 5;

      // 0 = natural end, null/undefined = killed by stop()
      settle(resolve, code);
    });
  });
}

// ─── Main loop ───────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function broadcastLoop() {
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

    try {
      await runFFmpeg(batch);
    } catch (err) {
      log('error', 'broadcast', `FFmpeg error: ${err.message}`);
      if (err.message.includes('not found')) {
        // FFmpeg not installed — stop the loop, don't spam logs
        state.isRunning = false;
        break;
      }
      await sleep(3000);
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
    state.ffmpegProc.kill('SIGTERM');
    state.ffmpegProc = null;
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
    state.ffmpegProc.kill('SIGTERM');
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

module.exports = { start, stop, setMode, getState, isRunning };
