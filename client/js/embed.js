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
  var video = document.getElementById('embed-video');
  var playBtn = document.getElementById('embed-play');
  var nowEl = document.getElementById('embed-now');
  var liveEl = document.getElementById('embed-live');
  var stationEl = document.getElementById('embed-station-link');

  var hls = null;
  var playing = false;
  var liveActive = false;
  var isVideo = false;
  var attachedUrl = null;
  var attachedMedia = null;

  function currentUrl() {
    return liveActive ? HLS_LIVE_URL : HLS_URL;
  }

  function currentMedia() {
    return isVideo ? video : audio;
  }

  function resetMedia(media) {
    if (!media) return;
    try { media.pause(); } catch (e) {}
    try {
      media.removeAttribute('src');
      media.load();
    } catch (e) {}
  }

  function attach(url) {
    var media = currentMedia();
    if (attachedUrl === url && attachedMedia === media) return;
    attachedUrl = url;
    attachedMedia = media;
    if (hls) { hls.destroy(); hls = null; }
    resetMedia(media === audio ? video : audio);
    if (window.Hls && window.Hls.isSupported()) {
      hls = new window.Hls({ liveSyncDurationCount: 3 });
      hls.loadSource(url);
      hls.attachMedia(media);
    } else {
      media.src = url; // Safari native HLS
    }
  }

  function setPlaying(next) {
    playing = next;
    playBtn.innerHTML = playing ? '&#10074;&#10074;' : '&#9654;';
    playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  }

  playBtn.addEventListener('click', function () {
    if (playing) {
      currentMedia().pause();
      setPlaying(false);
      return;
    }
    attach(currentUrl());
    currentMedia().play().then(function () { setPlaying(true); }).catch(function () {
      nowEl.textContent = 'Stream unavailable';
    });
  });

  function refreshStatus() {
    fetch('/api/stream/status')
      .then(function (r) { return r.json(); })
      .then(function (s) {
        var wasLive = liveActive;
        var wasVideo = isVideo;
        liveActive = !!s.liveActive;
        isVideo = !liveActive && !!s.isVideo;
        liveEl.classList.toggle('on', liveActive);
        var np = s.nowPlaying || {};
        nowEl.textContent = liveActive
          ? 'Live broadcast'
          : [np.artist, np.title].filter(Boolean).join(' — ') || 'Off air';
        if (playing && (wasLive !== liveActive || wasVideo !== isVideo)) {
          attach(currentUrl());
          currentMedia().play().catch(function () {});
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
