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

const LIVE_DIR = path.join(config.paths.hlsOutput, 'live');
const STATE_PATH = path.join(config.paths.hlsOutput, 'live_state.json');

let state = {
  isLive: false,
  startedAt: null,
  ffmpegProc: null,
};

function writeLiveState() {
  try {
    fs.writeFileSync(
      STATE_PATH,
      JSON.stringify(
        { isLive: state.isLive, startedAt: state.startedAt, updatedAt: new Date().toISOString() },
        null,
        2,
      ),
    );
  } catch (err) {
    log('error', 'live', `Failed to write live_state.json: ${err.message}`);
  }
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

  const proc = spawn('ffmpeg', args, {
    stdio: ['pipe', 'ignore', 'pipe'],
    windowsHide: true,
  });

  proc.stderr.on('data', chunk => {
    for (const line of chunk.toString().split('\n')) {
      const l = line.trim();
      if (l && /error|invalid|failed/i.test(l)) log('error', 'live', l);
    }
  });

  proc.on('error', err => {
    log('error', 'live', `FFmpeg spawn error: ${err.message}`);
    state.isLive = false;
    state.ffmpegProc = null;
    writeLiveState();
  });

  proc.on('close', code => {
    log('info', 'live', `FFmpeg exited (code ${code})`);
    state.isLive = false;
    state.ffmpegProc = null;
    writeLiveState();
  });

  state.isLive = true;
  state.startedAt = new Date().toISOString();
  state.ffmpegProc = proc;
  writeLiveState();
  log('info', 'live', 'Live broadcast started');
}

function pushAudio(buffer) {
  if (!state.isLive || !state.ffmpegProc) return;
  try {
    state.ffmpegProc.stdin.write(buffer);
  } catch (err) {
    log('warn', 'live', `Audio write error: ${err.message}`);
  }
}

function stopLive() {
  if (!state.isLive) return;
  if (state.ffmpegProc) {
    try { state.ffmpegProc.stdin.end(); } catch {}
  }
  state.isLive = false;
  state.startedAt = null;
  state.ffmpegProc = null;
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
