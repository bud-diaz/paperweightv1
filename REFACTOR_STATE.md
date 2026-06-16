---
# Refactor State
phase: 4
status: complete
last_completed: Phase 4 - Player Core (hls-client.js + player.js)
notes: |
  Phase 1: Extracted 992 CSS lines → client/css/ (4 files).
  Phase 2: state.js (113 lines), utils.js (54 lines).
  Phase 3: api.js (813 lines) — all 50+ fetch call sites.

  Phase 4: Created two player core modules:

  client/js/hls-client.js (183 lines)
    Exports: init, getHls, isVideoMode, isLiveActive, getStationName,
             isPingActive, activeMediaEl, activeHlsUrl, clearHlsRetry,
             resetHlsRetry, scheduleHlsRetry, setupHls, ping,
             startPingInterval, stopPingInterval, fetchStreamStatus.
    Owns local state: hls, hlsRetryTimer, hlsRetryAttempt, pingInterval,
                      currentIsVideo, currentLiveActive, stationName.

  client/js/player.js (283 lines)
    Exports: registerCallbacks, activeTrack, resetArtFlip, renderArtBack,
             renderWaveform, render, togglePlay, stopPreview, selectVOD,
             goLive, skipTrack, seekWaveform, toggleDrawer, toggleShare.
    Owns local state: previewAudio, previewTimer, previewTickInt,
                      artFlipped, artBackCache, artLastTrackKey.

  DOM nodes render() touches (29 IDs + 3 querySelector targets):
    document.documentElement (--color CSS var)
    #ambient, #bottom-accent, #on-air-dot, #on-air-text, #art-box
    .pulse-ring (all), #lib-btn, #queue-btn
    #share-tab-label, #auth-badge
    #type-badge, #back-live-btn
    #track-title, #track-creator, #track-station
    #on-air-badge, #pr1, #pr2
    #play-icon, #pause-icon, #play-btn
    #skip-prev, #skip-next
    #waveform (via renderWaveform)
    #time-elapsed, #time-remain
    #lib-drawer, #queue-drawer, #share-drawer (via setDrawer)
    #share-tab, #account-tab-label, #share-chevron

  CIRCULAR DEPENDENCY RESOLUTION:
    fetchStreamStatus() needs render() (player.js) and ASCII functions
    (Phase 5). If hls-client imported player.js and player.js imported
    hls-client.js, that would be a true circular import.
    Solution: hls-client.js uses callback injection via init().
    player.js calls hls-client.init({ onRender: render, ... }) in Phase 8.
    No circular import exists in the module graph.

  REMAINING CIRCULAR DEPENDENCY RISK (Phase 8):
    player.js calls _buildLibrary() and _loadQueue() — these will be
    provided by library.js (Phase 6) and player (queue section) respectively.
    Also: _openModal, _setModalTab, _checkVaultGate come from modal.js
    (Phase 6). All wired via registerCallbacks() in main.js.

  STATE MUTATION PATTERN NOTE (Phase 8 prerequisite):
    state.js exports `export let state = { ... }`. Object property mutations
    (state.playing = true, state.nowPlaying = x) work fine through ES module
    imports. Whole-object replacements like `state = { ...state, track: t }`
    are NOT allowed from importers. player.js replaces these with
    Object.assign(state, { ... }) to stay compatible.

  LOCAL STATE vs STATE.JS:
    Mutable primitives that one module owns exclusively are kept as module-
    local `let` variables rather than imported from state.js (which would
    create read-only binding issues). state.js values for these serve as
    documented initial values only. Affected fields:
      hls-client.js: hls, hlsRetryTimer, hlsRetryAttempt, pingInterval,
                     currentIsVideo, currentLiveActive, stationName
      player.js:     previewAudio, previewTimer, previewTickInt,
                     artFlipped, artBackCache, artLastTrackKey

  EVENT LISTENERS OWNED BY PLAYER (to be wired in main.js, Phase 8):
    #play-btn        click → togglePlay
    #skip-prev       click → skipTrack(-1)
    #skip-next       click → skipTrack(1)
    #back-live-btn   click → goLive
    #lib-btn         click → toggleDrawer('lib')
    #queue-btn       click → toggleDrawer('queue')
    #share-area      click → toggleShare
    #account-area    click → open share drawer + scroll to auth-toggle
    #waveform        click → seekWaveform
    #art-flip        click → toggle artFlipped, renderArtBack
    .view-tab (all)  click → switch PLAY / STUDIO view
    #pw-wordmark-text mousedown/touchstart → long-press enterDashboard

  Phase 3 error-handling risks: (unchanged — see above)
---
