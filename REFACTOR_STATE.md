---
# Refactor State
phase: 5
status: complete
last_completed: Phase 5 - Library, Auth, and ASCII
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

  client/js/player.js (284 lines)
    Exports: registerCallbacks, activeTrack, resetArtFlip, renderArtBack,
             renderWaveform, render, togglePlay, stopPreview, startGatedPreview,
             selectVOD, goLive, skipTrack, seekWaveform, toggleDrawer, toggleShare.
    Owns local state: previewAudio, previewTimer, previewTickInt,
                      artFlipped, artBackCache, artLastTrackKey.
    NOTE: startGatedPreview added to exports in Phase 5 so library.js can
          receive it as a callback via init().

  Phase 5: Three feature modules — no cross-imports between them:

  client/js/ascii.js
    Exports: init, asciiStart, asciiStop, asciiInitAudio, asciiLoadArtwork,
             drawAsciiArt.
    Owns local state: asciiMode, asciiRafId, asciiAnalyser, asciiAudioCtx,
                      asciiAudioSrc, asciiArtImg, asciiArtId, asciiVidOff,
                      asciiStartTime.
    Injected callbacks: isVideoMode (→ hls-client), getStationName (→ hls-client).
    Imports: state, ASCII_DENSITY from state.js; el from utils.js.

  client/js/auth.js
    Exports: init, loadAuthState, toggleAuthSection, renderAuthSection,
             setAuthTab, submitAuth, logoutListener, handleSetPassword,
             initAuthHandlers.
    Owns local state: authTab, authOpen.
    Mutates authState via Object.assign (not whole-object replace).
    Injected callbacks: loadLibrary (→ library.js).
    Imports: authState from state.js; el from utils.js; api from api.js.
    Uses api.auth.me(), api.auth.listenerMe(), api.auth.login(),
         api.auth.register(), api.auth.logout(), api.auth.setPassword().

  client/js/library.js
    Exports: init, normalizeTrack, loadLibrary, buildLibRow, buildLibrary,
             updateListenerQueuePill, getListenerQueue, initListenerQueueHandlers.
    Owns local state: listenerQueue (module-local let; reassigned on clear).
    Mutates LIBRARY via .length = 0 + push (no whole-array replace).
    Mutates LIBRARY_STRUCTURE via Object.assign (no whole-object replace).
    Injected callbacks: selectVOD, startGatedPreview (→ player.js),
                        openModal, setModalTab (→ modal.js, Phase 6).
    Imports: state, LIBRARY, LIBRARY_STRUCTURE, authState from state.js;
             el, showToast, trackColor, generateWaveform, fmt, esc from utils.js;
             api from api.js.

  CROSS-IMPORT VERIFICATION (Phase 5):
    ascii.js   → does NOT import auth.js or library.js ✓
    auth.js    → does NOT import ascii.js or library.js ✓
    library.js → does NOT import ascii.js or auth.js ✓

  VAULT/AUTH BOUNDARY JUDGMENT CALLS:
    - Vault gate checking (_checkVaultGate) stays in player.js (called during
      preview; payment modal wiring is Phase 6).
    - Library row "$" button → openModal/setModalTab callback (Phase 6 modal).
    - Listener queue auth check (loggedIn, tier) lives in library.js because
      the queue button handler is library.js-owned DOM. Reads authState directly
      (imported from state.js, mutated by auth.js via Object.assign).

  EVENT HANDLER INIT FUNCTIONS (wired in main.js, Phase 8):
    auth.initAuthHandlers()
    library.initListenerQueueHandlers()

  PHASE 8 CALLBACK WIRING PLAN:
    ascii.init({ isVideoMode: hlsClient.isVideoMode,
                 getStationName: hlsClient.getStationName })
    auth.init({ loadLibrary: library.loadLibrary })
    library.init({ selectVOD: player.selectVOD,
                   startGatedPreview: player.startGatedPreview,
                   openModal: modal.openModal,       // Phase 6
                   setModalTab: modal.setModalTab })  // Phase 6
    hlsClient.init({ onRender: player.render,
                     onAsciiStart: ascii.asciiStart,
                     onAsciiStop: ascii.asciiStop,
                     onAsciiLoadArtwork: ascii.asciiLoadArtwork })
    player.registerCallbacks({ asciiInitAudio: ascii.asciiInitAudio,
                                openModal: modal.openModal,
                                setModalTab: modal.setModalTab,
                                checkVaultGate: payment.checkVaultGate,
                                buildLibrary: library.buildLibrary,
                                loadQueue: player.loadQueue })

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
    fetchStreamStatus() needs render() (player.js) and ASCII functions.
    Solution: hls-client.js uses callback injection via init().
    player.js calls hls-client.init({ onRender: render, ... }) in Phase 8.
    No circular import exists in the module graph.

  STATE MUTATION PATTERN NOTE:
    state.js exports `export let state = { ... }`. Object property mutations
    (state.playing = true, state.nowPlaying = x) work fine through ES module
    imports. Whole-object replacements like `state = { ...state, track: t }`
    are NOT allowed from importers. player.js, auth.js use Object.assign(state, ...)
    to stay compatible. LIBRARY uses .length = 0 + push. LIBRARY_STRUCTURE uses
    Object.assign(LIBRARY_STRUCTURE, data).

  LOCAL STATE vs STATE.JS:
    Mutable primitives that one module owns exclusively are kept as module-
    local `let` variables. state.js values serve as documented initial values only.
      hls-client.js: hls, hlsRetryTimer, hlsRetryAttempt, pingInterval,
                     currentIsVideo, currentLiveActive, stationName
      player.js:     previewAudio, previewTimer, previewTickInt,
                     artFlipped, artBackCache, artLastTrackKey
      ascii.js:      asciiMode, asciiRafId, asciiAnalyser, asciiAudioCtx,
                     asciiAudioSrc, asciiArtImg, asciiArtId, asciiVidOff,
                     asciiStartTime
      auth.js:       authTab, authOpen
      library.js:    listenerQueue

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

  Phase 3 error-handling risks: (unchanged — see original notes)
---
