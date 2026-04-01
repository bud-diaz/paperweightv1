let hls = null;
let statusInterval = null;
let pingInterval = null;
let initialized = false;
let selectedTipCents = null;

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

// ── Tip panel ─────────────────────────────────────────────────────────────────

async function initTipPanel() {
  // Detect ?tipped=1 from Stripe success redirect — show thank-you, clean URL.
  const params = new URLSearchParams(window.location.search);
  if (params.has('tipped')) {
    params.delete('tipped');
    const clean = window.location.pathname
      + (params.toString() ? '?' + params.toString() : '')
      + window.location.hash;
    history.replaceState(null, '', clean);
    const ty = el('tip-thankyou');
    ty.hidden = false;
    setTimeout(() => { ty.hidden = true; }, 5000);
  }

  // Load creator-configured tip amounts.
  // Fails silently if Stripe isn't configured or tip-config is unavailable.
  try {
    const res = await fetch('/api/payment/tip-config');
    const cfg = await res.json();
    if (!cfg.enabled || !cfg.amounts?.length) return;

    const panel      = el('tip-panel');
    const presetsEl  = el('tip-presets');
    const customRow  = el('tip-custom-row');
    const customInput = el('tip-custom-input');
    const submitBtn  = el('tip-submit');
    const msgEl      = el('tip-msg');

    // Render preset amount buttons
    presetsEl.innerHTML = cfg.amounts.map(cents => {
      const label = cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
      return `<button class="tip-preset-btn" data-cents="${cents}">${label}</button>`;
    }).join('');

    if (cfg.customEnabled) customRow.hidden = false;

    // Preset selection — one active at a time
    presetsEl.querySelectorAll('.tip-preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        presetsEl.querySelectorAll('.tip-preset-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        selectedTipCents = parseInt(btn.dataset.cents, 10);
        customInput.value = '';
        msgEl.textContent = '';
      });
    });

    // Typing in custom field clears preset selection
    customInput.addEventListener('input', () => {
      presetsEl.querySelectorAll('.tip-preset-btn').forEach(b => b.classList.remove('selected'));
      selectedTipCents = null;
    });

    submitBtn.addEventListener('click', async () => {
      let cents = selectedTipCents;
      if (!cents && cfg.customEnabled && customInput.value) {
        cents = Math.round(parseFloat(customInput.value) * 100);
      }
      if (!cents || cents < 100) {
        msgEl.className   = 'error-msg';
        msgEl.textContent = 'Select an amount first';
        return;
      }

      submitBtn.disabled     = true;
      submitBtn.textContent  = 'Loading…';

      try {
        const tipRes = await fetch('/api/payment/tip', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ amountCents: cents }),
        });
        const data = await tipRes.json();
        if (!tipRes.ok) throw new Error(data.error || 'Failed to start checkout');
        window.location.href = data.checkoutUrl;
      } catch (err) {
        submitBtn.disabled    = false;
        submitBtn.textContent = 'Send tip';
        msgEl.className       = 'error-msg';
        msgEl.textContent     = err.message;
      }
    });

    panel.hidden = false;
  } catch { /* tip unavailable — fail silently, station page still works */ }
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

  // Auto-start if ?autoplay=1 (e.g. from station sticker deep-link)
  const apParams = new URLSearchParams(window.location.search);
  if (apParams.get('autoplay') === '1') {
    apParams.delete('autoplay');
    const clean = window.location.pathname
      + (apParams.toString() ? '?' + apParams.toString() : '')
      + window.location.hash;
    history.replaceState(null, '', clean);
    togglePlay();
  }

  // Tip panel — async, does not block player init
  initTipPanel();
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
