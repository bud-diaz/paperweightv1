let hls = null;
let statusInterval = null;
let pingInterval = null;
let initialized = false;

const HLS_URL = '/hls/stream/index.m3u8';
const STATUS_INTERVAL_MS = 10_000;
const PING_INTERVAL_MS   = 30_000;

function el(id) { return document.getElementById(id); }

function setNowPlaying(status) {
  const np = status.nowPlaying;
  if (np) {
    el('now-playing-title').textContent  = np.title  || 'Unknown title';
    el('now-playing-artist').textContent = np.artist || '';
  } else {
    el('now-playing-title').textContent  = status.isLive ? 'On Air' : 'Off Air';
    el('now-playing-artist').textContent = '';
  }
  if (status.station) el('station-name').textContent = status.station;

  const listenerEl = el('listener-text');
  if (listenerEl && typeof status.listenerCount === 'number') {
    listenerEl.textContent = status.listenerCount === 1
      ? '1 listening now'
      : `${status.listenerCount} listening now`;
  }
}

async function fetchStatus() {
  try {
    const res = await fetch('/api/stream/status');
    const data = await res.json();
    setNowPlaying(data);
  } catch { /* silently ignore */ }
}

async function ping() {
  try { await fetch('/api/stream/ping', { method: 'POST' }); } catch { /* ignore */ }
}

function setupHls(audio) {
  if (window.Hls && Hls.isSupported()) {
    hls = new Hls({ lowLatencyMode: false });
    hls.loadSource(HLS_URL);
    hls.attachMedia(audio);
    hls.on(Hls.Events.ERROR, (_, data) => {
      if (data.fatal) {
        el('player-hint').textContent = 'Stream unavailable — check server';
      }
    });
  } else if (audio.canPlayType('application/vnd.apple.mpegurl')) {
    // Safari native HLS
    audio.src = HLS_URL;
  } else {
    el('player-hint').textContent = 'HLS not supported in this browser';
  }
}

function togglePlay() {
  const audio = el('audio-el');
  const hint  = el('player-hint');

  if (audio.paused) {
    if (!hls && !audio.src) setupHls(audio);
    audio.play().then(() => {
      el('icon-play').hidden  = true;
      el('icon-pause').hidden = false;
      hint.textContent = '';
      el('waveform')?.classList.remove('paused');
      if (!pingInterval) pingInterval = setInterval(ping, PING_INTERVAL_MS);
      ping();
    }).catch(() => {
      hint.textContent = 'Playback blocked — tap again';
    });
  } else {
    audio.pause();
    el('icon-play').hidden  = false;
    el('icon-pause').hidden = true;
    hint.textContent = 'Paused';
    el('waveform')?.classList.add('paused');
  }
}

export function initPlayer() {
  if (initialized) return;
  initialized = true;

  el('waveform')?.classList.add('paused');

  // Fetch station name and now playing
  fetch('/api/health').then(r => r.json()).then(d => {
    el('station-name').textContent = d.station || 'Paperweight';
    document.title = d.station || 'Paperweight';
  }).catch(() => {});

  fetchStatus();
  statusInterval = setInterval(fetchStatus, STATUS_INTERVAL_MS);

  el('play-btn').addEventListener('click', togglePlay);
}

export function destroyPlayer() {
  clearInterval(statusInterval);
  clearInterval(pingInterval);
  statusInterval = null;
  pingInterval   = null;
  initialized    = false;

  const audio = el('audio-el');
  audio.pause();

  if (hls) {
    hls.destroy();
    hls = null;
  }

  el('icon-play').hidden  = false;
  el('icon-pause').hidden = true;
  el('player-hint').textContent = 'Click to start stream';
  el('waveform')?.classList.add('paused');
}
