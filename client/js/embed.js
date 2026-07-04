/**
 * embed.js — the /embed mini player. Plain script (not a module) so it works
 * with the file:// fallback and keeps the page down to two script tags.
 * Plays the public live HLS stream only; no auth, no gated content.
 */
(function () {
  'use strict';

  var HLS_URL = '/hls/stream/index.m3u8';
  var HLS_LIVE_URL = '/hls/live/index.m3u8';

  var audio = document.getElementById('embed-audio');
  var playBtn = document.getElementById('embed-play');
  var nowEl = document.getElementById('embed-now');
  var liveEl = document.getElementById('embed-live');
  var stationEl = document.getElementById('embed-station-link');

  var hls = null;
  var playing = false;
  var liveActive = false;
  var attachedUrl = null;

  function currentUrl() {
    return liveActive ? HLS_LIVE_URL : HLS_URL;
  }

  function attach(url) {
    if (attachedUrl === url) return;
    attachedUrl = url;
    if (hls) { hls.destroy(); hls = null; }
    if (window.Hls && window.Hls.isSupported()) {
      hls = new window.Hls({ liveSyncDurationCount: 3 });
      hls.loadSource(url);
      hls.attachMedia(audio);
    } else {
      audio.src = url; // Safari native HLS
    }
  }

  function setPlaying(next) {
    playing = next;
    playBtn.innerHTML = playing ? '&#10074;&#10074;' : '&#9654;';
    playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  }

  playBtn.addEventListener('click', function () {
    if (playing) {
      audio.pause();
      setPlaying(false);
      return;
    }
    attach(currentUrl());
    audio.play().then(function () { setPlaying(true); }).catch(function () {
      nowEl.textContent = 'Stream unavailable';
    });
  });

  function refreshStatus() {
    fetch('/api/stream/status')
      .then(function (r) { return r.json(); })
      .then(function (s) {
        var wasLive = liveActive;
        liveActive = !!s.liveActive;
        liveEl.classList.toggle('on', liveActive);
        var np = s.nowPlaying || {};
        nowEl.textContent = liveActive
          ? 'Live broadcast'
          : [np.artist, np.title].filter(Boolean).join(' — ') || 'Off air';
        if (playing && wasLive !== liveActive) {
          attach(currentUrl());
          audio.play().catch(function () {});
        }
      })
      .catch(function () {});
  }

  fetch('/api/health')
    .then(function (r) { return r.json(); })
    .then(function (h) { if (h.station) stationEl.textContent = h.station; })
    .catch(function () {});

  refreshStatus();
  setInterval(refreshStatus, 15000);
})();
