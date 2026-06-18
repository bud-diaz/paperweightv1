---
# Refactor State
phase: 8
status: complete
last_completed: Phase 8 - main.js wiring + creator.html trim
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

  Phase 6: Payment module:

  client/js/payment.js
    Exports: init, openModal, closeModal, setModalTab, buildTipPresets,
             loadTipConfig, checkVaultGate, startVaultUnlock,
             handleTippedParam, initPaymentHandlers, initFloatingTip.
    Owns local state: tipAmounts, selectedTipCents (primitives reassigned
      locally — cannot be ES module live exports from state.js).
    Injected callbacks: getStationName (→ hls-client), render (→ player.js),
      setAuthTab (→ auth.js), toggleAuthSection (→ auth.js).
    Imports: state, authState from state.js; el, esc from utils.js;
             api from api.js.

    STRIPE REDIRECT VERIFICATION — all flows go through api.payment.*:
      tip checkout:        api.payment.sendTip(cents) → { res, data }
      sub/all-access:      api.payment.checkoutUrl(tier) → data
      vault subscribe btn: api.payment.checkoutUrl() → data
      vault unlock:        api.payment.vaultUnlock(body) → data
      vault options read:  api.payment.vaultUnlockOptions(id) → data
      tip config:          api.payment.tipConfig() → data
      No raw fetch() calls exist in payment.js. ✓

    MODAL STATE NOTE:
      tipAmounts and selectedTipCents are kept module-local in payment.js.
      They do NOT need to live in state.js because:
        • Only payment.js reads or writes them.
        • They are primitive-reassigned (tipAmounts = [...]), so they could
          not be ES module live exports from state.js in any case.
      If a future module needs the active tip amount (e.g. analytics), it
      would need a getter export or they would move to state.js at that point.

    checkVaultGate() design:
      "Read-only" means it only fetches options and renders the gate UI
      (displaying unlock choices to the user). It does NOT initiate any
      payment. The actual Stripe checkout redirect is in startVaultUnlock(),
      which is called when the user clicks an UNLOCK button.

    Event wiring deferred to initPaymentHandlers() (Phase 8 main.js).
    Floating tip animation deferred to initFloatingTip() (Phase 8 main.js).

  Phase 3 error-handling risks: (unchanged — see original notes)

  Phase 7: Worklet + 12 dashboard modules:

  client/js/worklet-processor.js
    Plain AudioWorklet script (NOT an ES module). Contains PaperweightPCM class
    registered as 'pw-pcm'. Served at /js/worklet-processor.js — referenced via
    liveAudioCtx.audioWorklet.addModule('/js/worklet-processor.js') instead of
    the blob URL approach used in the original creator.html WORKLET_CODE string.

  client/js/dashboard/index.js
    Exports: init, tryDashAuth, setDashGate, initDashboard, loadDashboard,
             loadDashAccounts, loadDashRuntime, loadDashPaymentConfig,
             checkLaunchAcceptance, makeTypeahead, initDashGateHandlers,
             DASH_ACCOUNTS.
    Owns local state: dashboardInitialized, pendingChallenge, dashboardLoaded,
                      DASH_ACCOUNTS.
    Orchestrates all dashboard sub-module loads via injected callbacks.
    Uses api.auth.dashboardLogin(), api.auth.dashboardVerify2fa(),
         api.dashboard.check(), api.dashboard.accounts(),
         api.dashboard.runtime(), api.dashboard.paymentConfig(),
         api.system.launchStatus(), api.system.launchAccept().
    NOTE: stationName accessed from window._stationName (set by main.js Phase 8).

  client/js/dashboard/station.js
    Exports: init, loadDashStation, checkStationHealth, initStationHandlers.
    Uses api.dashboard.station.get/health/updateUrl.

  client/js/dashboard/bio.js
    Exports: init, loadBioPanel, loadDashBio, updateBioSectionState,
             initBioHandlers.
    Contains: SOCIAL_ICONS constant (6 platform SVGs).
    loadBioPanel uses api.library.creatorProfile() (public endpoint).
    loadDashBio uses api.creator.profile() (dashboard endpoint).
    Uses api.creator.updateProfile(), api.creator.uploadPic().
    NOTE: bioSessionPassed set via window._bioSessionPassed for Phase 8.

  client/js/dashboard/vault.js
    Exports: init, loadDashVaultStats, bindVaultStatButtons, openVaultPanel,
             loadDashLockedTracks, buildDashLibItem, buildDashLibProject,
             refreshDashTokenList, loadDashLibrary, loadDashTokens,
             refreshAssignmentList, initTokenHandlers.
    Owns local state: vaultStatsBound, _activeVaultPanel.
    Injected callbacks: loadDashVaultStats (self-ref for refresh), loadLibrary
                        (listener-side), makeTypeahead, getDashAccounts.
    Uses api.dashboard.media.*, api.dashboard.tokens.*, api.dashboard.vault.*.

  client/js/dashboard/projects.js
    Exports: init, loadDashProjects, buildDashProjectCard, initProjectHandlers.
    Injected callbacks: loadDashProjects (self), loadDashLibrary, loadDashVaultStats.
    Uses api.dashboard.media.list(), api.dashboard.vault.*,
         api.dashboard.vault.addTrack/removeTrack/deleteProject/updateProject.

  client/js/dashboard/broadcast.js
    Exports: init, loadDashBroadcast, loadDashBroadcastQueue, initBroadcastHandlers.
    Uses api.stream.status() (public endpoint), api.dashboard.broadcast.*.
    initBroadcastHandlers wires the global .lib-queue-btn click delegation.

  client/js/dashboard/live.js
    Exports: init, loadDashLive, startGoLive, stopGoLive, initLiveHandlers.
    Owns local state: liveAudioCtx, liveWorkletNode, liveMediaStream,
                      liveTimerInt, liveStartedAt.
    Uses api.dashboard.live.*, api.dashboard.broadcast.* (not directly),
         liveAudioCtx.audioWorklet.addModule('/js/worklet-processor.js').
    Uses fmt() from utils.js for timer display.

  client/js/dashboard/schedule.js
    Exports: init, loadDashSchedule, initScheduleHandlers.
    Uses api.stream.status() (mode display), api.dashboard.broadcast.setMode(),
         api.dashboard.schedule.list/createBlock/updateBlock/deleteBlock.

  client/js/dashboard/upload.js
    Exports: init, queueUploads, initUploadHandlers.
    Owns local state: uploadFiles[].
    Injected callbacks: loadDashVaultStats, loadDashLibrary, loadLibrary.
    Uses api.dashboard.media.upload().

  client/js/dashboard/analytics.js
    Exports: init, loadDashAnalytics, loadAnalyticsExpanded, loadDashTipConfig,
             loadPlayCounts, initAnalyticsHandlers.
    Owns local state: _analyticsExpandedLoaded.
    Injected callbacks: buildTipPresets (from payment.js; called with new amounts).
    Uses api.analytics.live/top/history/playcounts(),
         api.dashboard.tipConfig.get/update().
    NOTE: _buildTipPresets(amounts) passes new amounts — Phase 8 wiring should
          use a wrapper that sets tipAmounts in payment.js then calls buildTipPresets.

  client/js/dashboard/twofa.js
    Exports: init, loadDash2FA, startTwoFASetup, initTwoFAHandlers.
    Uses api.dashboard.twoFA.status/setup/confirm/disable.

  client/js/dashboard/search.js
    Exports: init, loadCreatorType, loadRadioHostStatus, initExtSearchPanel.
    Owns local state: currentExtPlatform.
    Injected callbacks: loadDashLibrary, loadDashVaultStats.
    Imports LIBRARY_STRUCTURE from state.js for library search.
    Uses api.dashboard.creatorType(), api.dashboard.radioHostStatus(),
         api.dashboard.externalSearch(), api.dashboard.media.importExternal().
    Contains fmtDuration(secs) → "m:ss" local helper (different from fmt in utils.js).

  CIRCULAR IMPORT VERIFICATION (Phase 7):
    All dashboard/ modules import only from ../api.js, ../utils.js, and ../state.js.
    dashboard/index.js does NOT import other dashboard/* modules — all cross-module
    calls use the callback injection pattern. No circular imports exist. ✓

  CALLBACK WIRING PLAN (Phase 8 main.js additions):
    dashIndex.init({
      loadDashStation:       station.loadDashStation,
      loadDashVaultStats:    vault.loadDashVaultStats,
      loadDashBroadcast:     broadcast.loadDashBroadcast,
      loadDashLive:          live.loadDashLive,
      loadRadioHostStatus:   search.loadRadioHostStatus,
      loadDashSchedule:      schedule.loadDashSchedule,
      loadDashProjects:      projects.loadDashProjects,
      loadDashLibrary:       vault.loadDashLibrary,
      loadDashAnalytics:     analytics.loadDashAnalytics,
      loadDash2FA:           twofa.loadDash2FA,
      loadDashTipConfig:     analytics.loadDashTipConfig,
      loadDashBio:           bio.loadDashBio,
      loadPlayCounts:        analytics.loadPlayCounts,
      bindVaultStatButtons:  vault.bindVaultStatButtons,
      initExtSearchPanel:    search.initExtSearchPanel,
      loadCreatorType:       search.loadCreatorType,
      initUploadHandlers:    upload.initUploadHandlers,
      loadDashTokens:        vault.loadDashTokens,
    })
    vault.init({
      loadDashVaultStats: vault.loadDashVaultStats,
      loadLibrary:        library.loadLibrary,
      makeTypeahead:      dashIndex.makeTypeahead,
      getDashAccounts:    () => dashIndex.DASH_ACCOUNTS,
    })
    projects.init({
      loadDashProjects:   projects.loadDashProjects,
      loadDashLibrary:    vault.loadDashLibrary,
      loadDashVaultStats: vault.loadDashVaultStats,
    })
    upload.init({
      loadDashVaultStats: vault.loadDashVaultStats,
      loadDashLibrary:    vault.loadDashLibrary,
      loadLibrary:        library.loadLibrary,
    })
    analytics.init({
      buildTipPresets: (amounts) => { payment._setTipAmounts(amounts); payment.buildTipPresets(); }
      // OR: analytics.init({ buildTipPresets: payment.buildTipPresets }) if payment
      //     exports a setter or loads from API on each call.
    })
    search.init({
      loadDashLibrary:    vault.loadDashLibrary,
      loadDashVaultStats: vault.loadDashVaultStats,
    })

  STATIONNAME PATTERN (Phase 7 → 8):
    dashboard/index.js reads window._stationName instead of module-local stationName.
    Phase 8 main.js must set window._stationName = stationName after init().
    Alternative: inject stationName as a callback in dashIndex.init().

  Phase 8: main.js wiring + creator.html trim. END OF REFACTOR.

  client/js/main.js (311 lines) — pure wiring layer, no business logic.
    Imports every module (core + all 12 dashboard sub-modules), wires every
    init({...}) callback per the Phase 5-7 plans above, calls every
    init*Handlers() export, binds the player-owned top-level DOM listeners
    that no module captured (play/skip/lib/queue/share/account/waveform/
    art-flip/view-tab/wordmark long-press), and replicates the original
    inline-script init() startup sequence exactly (station name fetch ->
    bio panel -> stream status + poll -> auth state -> library + queue ->
    tip config -> silent dashboard session restore -> initial render ->
    ?tipped=1 -> ?subscribed=1).

  CORRECTIONS TO THE PHASE 5-7 WIRING PLANS (found while wiring; the plan
  text above is left unedited as a historical record — these are the actual
  values used in main.js):
    - player.registerCallbacks({ ..., loadQueue: library.loadQueue }) —
      NOT player.loadQueue. loadQueue did not exist anywhere before Phase 8
      (see "logic relocated" below); it was added to library.js, not player.js.
    - dashboard/vault.js's handler-init export is initTokenHandlers(), not
      initVaultHandlers() as speculated in the original task brief.
    - analytics.init({ buildTipPresets }) needed a real implementation since
      payment.js has no setter for its module-local tipAmounts. Added
      payment.setTipAmounts(amounts) (small, documented export) and wired
      main.js: buildTipPresets: (amounts) => { payment.setTipAmounts(amounts);
      payment.buildTipPresets(); }.
    - dashboard/index.js, dashboard/bio.js, dashboard/analytics.js had latent
      Phase 7 bugs calling non-existent top-level api.* namespaces
      (api.system.*, api.creator.*, api.analytics.*) instead of the actual
      nested api.dashboard.system.*, api.dashboard.creator.*,
      api.dashboard.analytics.* paths. Fixed at the call sites (see "logic
      relocated" below) — required for Phase 8 wiring to work at all, since
      main.js calls these modules' loaders directly.

  LOGIC RELOCATED INTO EXISTING MODULES (found orphaned in the original
  inline script; no Phase 5/6/7 module had captured them; smallest-unit
  additions made to the most relevant existing module per task instructions
  — none of this logic was added to main.js):
    - library.js: added loadQueue() (queue-drawer rendering: scheduled-next
      block + recently-played list). Backs #queue-drawer, called by
      player.toggleDrawer('queue') via the loadQueue callback. Uses
      api.library.scheduleCurrent() + api.stream.status() instead of the
      original's raw fetch calls.
    - player.js: added initShareHandlers() (.share-opt copy-link / twitter /
      embed / rss wiring). Reads activeTrack().color and getStationName(),
      both already available in player.js.
    - dashboard/search.js: added initRadioHostHandlers()
      (#broadcast-header-toggle expand/collapse + #rh-switch radio-host-mode
      toggle). Manages the same radio-host-mode state as loadCreatorType()
      and triggers initExtSearchPanel()/loadRadioHostStatus(), both already
      owned by search.js. Uses api.dashboard.toggleRadioHost() instead of a
      raw dashFetch() call.
    - payment.js: added setTipAmounts(amounts) — minimal setter so
      dashboard/analytics.js's tip-config-save handler can refresh the
      listener-facing tip presets without giving up payment.js's ownership
      of tipAmounts as module-local state.
    - Bug fixes (not new logic, but required for correctness): dashboard/
      index.js, dashboard/bio.js, dashboard/analytics.js — corrected
      api.system/api.creator/api.analytics call sites to the real nested
      api.dashboard.system/api.dashboard.creator/api.dashboard.analytics paths.

  PLAYER-OWNED TOP-LEVEL LISTENERS — wired directly in main.js (not as a new
  module export, since they are simple one-line DOM bindings to existing
  player.js exports, matching the "Event listeners owned by player" plan):
    #play-btn, #skip-prev, #skip-next, #back-live-btn, #lib-btn, #queue-btn,
    #share-area, #account-area, #waveform, #art-flip, .view-tab (all),
    #pw-wordmark-text (long-press). The view-tab handler and the wordmark
    long-press's enterDashboard() both call dashboard.initDashboard()
    (idempotent, guarded by dashboardInitialized) instead of duplicating
    dashboard gate logic in main.js.

  STARTUP SEQUENCE DECISION: the original inline script's "silently restore
  creator session" IIFE (tryDashAuth() -> showDashContent()) is NOT
  separately exported from dashboard/index.js — only initDashboard() is,
  which performs the same probe-then-show-or-gate logic and is guarded by
  dashboardInitialized so calling it from main.js's init() is safe even if
  the user later triggers it again via the STUDIO tab or wordmark long-press.
  main.js's init() therefore calls dashIndex.initDashboard() directly in
  place of the original's bespoke IIFE.

  CREATOR.HTML TRIM:
    Removed the entire inline <script>...</script> block (original lines
    846-4672, the whole monolithic frontend script) and replaced it with a
    single line at the same position (end of body, after #credit, before
    </body>): <script type="module" src="js/main.js"></script>.
    creator.html: 849 lines (was 4675). Zero inline <script> content remains
    — the only other <script> tag in the file is the vendored
    <script src="/vendor/hls.min.js"></script> in <head>, present since
    Phase 1 and unrelated to the refactor. <head> still has exactly the 4
    Phase 1 CSS <link> tags (tokens.css, layout.css, auth.css, dashboard.css)
    plus the unrelated fonts.css link — nothing else changed. No markup was
    touched anywhere else in the file.

  FINAL FILE LINE COUNTS (Phase 8):
    client/creator.html              849  (was 4675 pre-trim)
    client/js/main.js                311  (new)
    client/js/api.js                 813
    client/js/state.js               117
    client/js/utils.js                52
    client/js/hls-client.js          193
    client/js/player.js              485  (was 435; +initShareHandlers)
    client/js/ascii.js               293
    client/js/auth.js                200
    client/js/library.js             250  (was 205; +loadQueue)
    client/js/payment.js             443  (was 429; +setTipAmounts)
    client/js/worklet-processor.js    18
    client/js/dashboard/index.js     361  (api.* call-site fix only)
    client/js/dashboard/station.js    75
    client/js/dashboard/bio.js       171  (api.* call-site fix only)
    client/js/dashboard/vault.js     535
    client/js/dashboard/projects.js  269
    client/js/dashboard/broadcast.js  68
    client/js/dashboard/live.js      132
    client/js/dashboard/schedule.js  176
    client/js/dashboard/upload.js     69
    client/js/dashboard/analytics.js 122  (api.* call-site fix only)
    client/js/dashboard/twofa.js      91
    client/js/dashboard/search.js    214  (was 170; +initRadioHostHandlers)
    client/css/tokens.css             43
    client/css/layout.css            620
    client/css/auth.css               59
    client/css/dashboard.css         269

  VERIFICATION PERFORMED:
    - node --check on main.js and payment.js: pass.
    - npm test: 55/55 pass (one pre-existing unrelated failure — missing
      vendored client/vendor/hls.min.js / node_modules in this checkout —
      resolved by running npm install; not caused by Phase 8 changes).
    - node scripts/generate-client-bundle.js: succeeds, 47 entries.
    - Dev server smoke test: GET /creator.html, /js/main.js,
      /js/dashboard/index.js, /js/worklet-processor.js, /api/health all
      return 200 with correct content; creator.html confirmed to contain
      exactly one inline-script-free <script type="module"> tag plus the
      unrelated vendored hls.min.js <script src> in <head>.

  DEFERRED CLEANUPS / TODOs (none blocking; out of scope for Phase 8 per
  task instructions, listed for future reference):
    - state.js still contains the vestigial WORKLET_CODE template literal
      (superseded by the standalone client/js/worklet-processor.js file in
      Phase 7). Not removed — touching state.js exports was out of scope
      for a pure wiring phase.
    - state.js exports many primitives (hls, asciiMode, liveAudioCtx, etc.)
      that are documented as "initial values only" and are not the live
      values actually used at runtime (each owning module keeps its own
      module-local copy). This duplication is intentional per the Phase 4-7
      design notes above but could be trimmed in a future cleanup pass.
    - No Phase 9 is planned. This is the end of the creator.html ->
      client/js/ ES module refactor.

  MANUAL SMOKE-TEST CHECKLIST (browser-based; cannot be performed by the
  agent — for the human to run against a live server with real vault media,
  Stripe/PayPal test keys, and FFmpeg installed):
    [ ] Player loads, shows live "On Air" state, play/pause works
    [ ] HLS reconnect/retry behavior after killing/restarting the broadcast
    [ ] Waveform click-to-seek on a selected VOD track
    [ ] Library drawer opens, gated tracks show lock icon + $ unlock button
    [ ] Vault gate modal renders unlock options; vault token/all-access flows
    [ ] Listener login / register / logout; password-set flow after Stripe
        redirect (?subscribed=1)
    [ ] Tip modal: presets render, custom amount, Stripe checkout redirect,
        ?tipped=1 thank-you state
    [ ] Floating tip bubble animates and opens modal on click/tap
    [ ] Share drawer: copy link, tweet intent, embed code copy, RSS link
    [ ] Dashboard auth gate: token login, 2FA challenge + verify, recovery
    [ ] Each dashboard section loads: station, vault stats, broadcast queue,
        live broadcast (go live / stop), schedule, projects, uploads,
        analytics (+ expanded 7-day view), tip config save, bio panel,
        2FA setup/disable, token management, external search (YouTube/
        SoundCloud/library), radio-host mode toggle + creator-type switch
    [ ] STUDIO/PLAY view-tab toggle; wordmark long-press enters STUDIO
    [ ] ASCII mode renders for audio and video playback
    [ ] First-launch legal acceptance modal appears once, accept persists
---
