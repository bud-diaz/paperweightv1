/**
 * Paperweight iOS hub shell. Plain script, no bundler — matches the rest of
 * the project's vanilla-JS style. Browses the public station directory and
 * plays a selected station by loading its own /embed mini player in an
 * iframe. The iframe is created once per selection and never torn down on
 * navigation between the search list and the player dock, so switching
 * screens never interrupts playback.
 */
(function () {
  'use strict';

  var DIRECTORY_API = 'https://system.paperweighthq.com/api/modules/paperweight/stations';
  var RECENTS_KEY = 'paperweight.recents';
  var MAX_RECENTS = 12;
  var OFFLINE_TIMEOUT_MS = 8000;

  var els = {
    query: document.getElementById('query'),
    results: document.getElementById('results'),
    dock: document.getElementById('dock'),
    dockHead: document.getElementById('dock-head'),
    dockName: document.getElementById('dock-name'),
    dockSlug: document.getElementById('dock-slug'),
    dockState: document.getElementById('dock-state'),
    frame: document.getElementById('station-frame'),
  };

  var searchTimer = null;
  var activeRequest = 0;
  var current = null;
  var recents = [];
  var offlineTimer = null;

  function prefsPlugin() {
    return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Preferences) || null;
  }

  function loadRecents() {
    var plugin = prefsPlugin();
    var read = plugin
      ? plugin.get({ key: RECENTS_KEY }).then(function (r) { return r && r.value; })
      : Promise.resolve(localStorage.getItem(RECENTS_KEY));
    return read.then(function (raw) {
      try { recents = raw ? JSON.parse(raw) : []; } catch (e) { recents = []; }
    }).catch(function () { recents = []; });
  }

  function saveRecents() {
    var data = JSON.stringify(recents);
    var plugin = prefsPlugin();
    if (plugin) { plugin.set({ key: RECENTS_KEY, value: data }).catch(function () {}); return; }
    try { localStorage.setItem(RECENTS_KEY, data); } catch (e) {}
  }

  function rememberStation(station) {
    recents = recents.filter(function (s) { return s.slug !== station.slug; });
    recents.unshift({
      slug: station.slug,
      name: station.name,
      url: station.url,
      nowPlaying: station.nowPlaying || '',
      live: !!station.live,
    });
    recents = recents.slice(0, MAX_RECENTS);
    saveRecents();
  }

  function markRecentOffline(slug, offline) {
    var changed = false;
    recents = recents.map(function (s) {
      if (s.slug === slug && s.offline !== offline) {
        changed = true;
        return Object.assign({}, s, { offline: offline });
      }
      return s;
    });
    if (changed) {
      saveRecents();
      if (!els.query.value.trim()) renderBrowse();
    }
  }

  function validUrl(url) {
    try {
      var parsed = new URL(url);
      return (parsed.protocol === 'http:' || parsed.protocol === 'https:') ? parsed : null;
    } catch (e) { return null; }
  }

  function setState(message) {
    els.results.innerHTML = '';
    var node = document.createElement('div');
    node.className = 'state';
    node.textContent = message;
    els.results.appendChild(node);
  }

  function renderStations(stations, heading) {
    els.results.innerHTML = '';
    if (heading) {
      var h = document.createElement('div');
      h.className = 'section-heading';
      h.textContent = heading;
      els.results.appendChild(h);
    }
    if (!stations.length) { setState('No stations found'); return; }
    stations.forEach(function (station) { els.results.appendChild(stationRow(station)); });
  }

  function stationRow(station) {
    var row = document.createElement('button');
    row.type = 'button';
    row.className = 'row';
    row.addEventListener('click', function () { selectStation(station); });

    var top = document.createElement('div');
    top.className = 'row-top';
    var name = document.createElement('div');
    name.className = 'row-name';
    name.textContent = station.name || station.slug || 'Untitled station';
    top.appendChild(name);
    if (station.offline) {
      var off = document.createElement('span');
      off.className = 'offline-badge';
      off.textContent = 'OFFLINE';
      top.appendChild(off);
    } else if (station.live) {
      var badge = document.createElement('span');
      badge.className = 'live-badge';
      badge.textContent = 'LIVE';
      top.appendChild(badge);
    }
    row.appendChild(top);

    var meta = document.createElement('div');
    meta.className = 'row-meta';
    meta.textContent = station.nowPlaying || (station.slug ? '/' + station.slug : 'Live station');
    row.appendChild(meta);
    return row;
  }

  function selectStation(station) {
    var parsed = validUrl(station.url);
    current = station;
    els.dock.hidden = false;
    els.dock.classList.add('expanded');
    els.dockName.textContent = station.name || station.slug || 'Untitled station';
    els.dockSlug.textContent = station.slug ? '/' + station.slug : (parsed ? parsed.hostname : '');

    if (offlineTimer) clearTimeout(offlineTimer);

    if (!parsed) {
      els.dockState.textContent = 'This station has an invalid player URL.';
      els.dockState.hidden = false;
      els.frame.removeAttribute('src');
      markRecentOffline(station.slug, true);
      return;
    }

    els.dockState.hidden = true;
    // Heuristic offline detection: the iframe's `load` event fires on
    // navigation completion even for a cross-origin target, so this doesn't
    // require the station to opt into CORS. If it hasn't fired within the
    // timeout, treat the station as unreachable rather than leaving a blank
    // player (BUSINESS_MODEL.md's "station offline" requirement for Mobile).
    offlineTimer = setTimeout(function () {
      if (current === station) {
        els.dockState.textContent = 'This station appears to be offline right now.';
        els.dockState.hidden = false;
        markRecentOffline(station.slug, true);
      }
    }, OFFLINE_TIMEOUT_MS);

    els.frame.src = new URL('/embed', parsed).href;
    rememberStation(station);
    if (!els.query.value.trim()) renderBrowse();
  }

  els.frame.addEventListener('load', function () {
    if (offlineTimer) { clearTimeout(offlineTimer); offlineTimer = null; }
    if (current) markRecentOffline(current.slug, false);
  });

  els.dockHead.addEventListener('click', function () {
    els.dock.classList.toggle('expanded');
  });

  function renderBrowse() {
    if (els.query.value.trim()) return;
    if (!recents.length) { setState('Search for a station to start listening.'); return; }
    renderStations(recents, 'Recently played');
  }

  function search() {
    var q = els.query.value.trim();
    if (!q) { renderBrowse(); return; }
    var requestId = ++activeRequest;
    setState('Searching stations...');
    var url = new URL(DIRECTORY_API);
    url.searchParams.set('q', q);
    url.searchParams.set('limit', '20');
    fetch(url.href, { headers: { Accept: 'application/json' } })
      .then(function (res) { if (!res.ok) throw new Error('Directory returned ' + res.status); return res.json(); })
      .then(function (data) {
        if (requestId !== activeRequest) return;
        renderStations(Array.isArray(data.stations) ? data.stations : []);
      })
      .catch(function () { if (requestId === activeRequest) setState('Directory unavailable — try again later.'); });
  }

  function loadTopStations() {
    if (els.query.value.trim() || recents.length) return;
    var requestId = ++activeRequest;
    var url = new URL(DIRECTORY_API);
    url.searchParams.set('limit', '20');
    fetch(url.href, { headers: { Accept: 'application/json' } })
      .then(function (res) { if (!res.ok) throw new Error(); return res.json(); })
      .then(function (data) {
        if (requestId !== activeRequest || els.query.value.trim() || recents.length) return;
        var stations = Array.isArray(data.stations) ? data.stations : [];
        if (stations.length) renderStations(stations, 'Popular stations');
      })
      .catch(function () {});
  }

  els.query.addEventListener('input', function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(search, 300);
  });

  loadRecents().then(function () {
    renderBrowse();
    loadTopStations();
  });
})();
