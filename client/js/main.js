/**
 * main.js — Pure wiring layer. No business logic lives here.
 *
 * Responsibilities:
 *   1. Import every module.
 *   2. Call each module's init({...}) with the cross-module callbacks it needs
 *      (callback-injection pattern documented in REFACTOR_STATE.md, avoids
 *      circular imports between sibling modules).
 *   3. Call every module's init*Handlers() function to wire DOM event listeners.
 *   4. Bind the small set of top-level player-owned DOM listeners that were
 *      never folded into a module export (view-tab switch, wordmark long-press,
 *      art-flip, drawer/share-area/account-area clicks — see player.js header
 *      comment "Event listeners owned by player").
 *   5. Replicate the original inline-script init() startup sequence exactly.
 *
 * window._stationName / window._bioSessionPassed are documented escape-hatch
 * globals: dashboard/index.js and dashboard/bio.js read them instead of
 * importing hls-client.js/state.js directly, to avoid import bloat across the
 * dashboard/ boundary (see REFACTOR_STATE.md "STATIONNAME PATTERN").
 */

import { state, authState } from './state.js';
import { el } from './utils.js';
import * as api from './api.js';

import * as hlsClient from './hls-client.js';
import * as player    from './player.js';
import * as ascii     from './ascii.js';
import * as auth      from './auth.js';
import * as library   from './library.js';
import * as payment   from './payment.js';

import * as dashIndex   from './dashboard/index.js';
import * as station     from './dashboard/station.js';
import * as bio         from './dashboard/bio.js';
import * as vault       from './dashboard/vault.js';
import * as projects    from './dashboard/projects.js';
import * as broadcast   from './dashboard/broadcast.js';
import * as live        from './dashboard/live.js';
import * as schedule    from './dashboard/schedule.js';
import * as upload      from './dashboard/upload.js';
import * as analytics   from './dashboard/analytics.js';
import * as twofa       from './dashboard/twofa.js';
import * as search      from './dashboard/search.js';

// ── Cross-module callback wiring ─────────────────────────────────────────────

ascii.init({
  isVideoMode:    hlsClient.isVideoMode,
  getStationName: hlsClient.getStationName,
});

auth.init({
  loadLibrary: library.loadLibrary,
});

library.init({
  selectVOD:         player.selectVOD,
  startGatedPreview: player.startGatedPreview,
  openModal:         payment.openModal,
  setModalTab:       payment.setModalTab,
});

hlsClient.init({
  onRender:           player.render,
  onAsciiStart:        ascii.asciiStart,
  onAsciiStop:         ascii.asciiStop,
  onAsciiLoadArtwork:  ascii.asciiLoadArtwork,
});

player.registerCallbacks({
  asciiInitAudio: ascii.asciiInitAudio,
  openModal:      payment.openModal,
  setModalTab:    payment.setModalTab,
  checkVaultGate: payment.checkVaultGate,
  buildLibrary:   library.buildLibrary,
  loadQueue:      library.loadQueue,
});

payment.init({
  getStationName:    hlsClient.getStationName,
  render:            player.render,
  setAuthTab:        auth.setAuthTab,
  toggleAuthSection: auth.toggleAuthSection,
});

dashIndex.init({
  loadDashStation:      station.loadDashStation,
  loadDashVaultStats:   vault.loadDashVaultStats,
  loadDashBroadcast:    broadcast.loadDashBroadcast,
  loadDashLive:         live.loadDashLive,
  loadRadioHostStatus:  search.loadRadioHostStatus,
  loadDashSchedule:     schedule.loadDashSchedule,
  loadDashProjects:     projects.loadDashProjects,
  loadDashLibrary:      vault.loadDashLibrary,
  loadDashAnalytics:    analytics.loadDashAnalytics,
  loadDash2FA:          twofa.loadDash2FA,
  loadDashPaymentConfig: dashIndex.loadDashPaymentConfig,
  loadDashTipConfig:    analytics.loadDashTipConfig,
  loadDashBio:          bio.loadDashBio,
  loadPlayCounts:       analytics.loadPlayCounts,
  bindVaultStatButtons: vault.bindVaultStatButtons,
  initExtSearchPanel:   search.initExtSearchPanel,
  loadCreatorType:      search.loadCreatorType,
  initUploadHandlers:   upload.initUploadHandlers,
  loadDashTokens:       vault.loadDashTokens,
});

vault.init({
  loadDashVaultStats: vault.loadDashVaultStats,
  loadLibrary:        library.loadLibrary,
  makeTypeahead:      dashIndex.makeTypeahead,
  getDashAccounts:    () => dashIndex.DASH_ACCOUNTS,
});

projects.init({
  loadDashProjects:   projects.loadDashProjects,
  loadDashLibrary:    vault.loadDashLibrary,
  loadDashVaultStats: vault.loadDashVaultStats,
});

upload.init({
  loadDashVaultStats: vault.loadDashVaultStats,
  loadDashLibrary:    vault.loadDashLibrary,
  loadLibrary:        library.loadLibrary,
});

analytics.init({
  // dashboard/analytics.js's "save tip config" handler passes the newly saved
  // amounts; payment.js owns tipAmounts as module-local state, so we ask it to
  // adopt the new amounts (setTipAmounts, added in Phase 8) before rebuilding
  // the listener-facing preset buttons.
  buildTipPresets: (amounts) => {
    payment.setTipAmounts(amounts);
    payment.buildTipPresets();
  },
});

search.init({
  loadDashLibrary:    vault.loadDashLibrary,
  loadDashVaultStats: vault.loadDashVaultStats,
});

// station.js, bio.js, broadcast.js, live.js, schedule.js, twofa.js have no-op
// init() (no callbacks needed) — called for consistency/forward-compatibility.
station.init();
bio.init();
broadcast.init();
live.init();
schedule.init();
twofa.init();

// ── Event handler wiring ───────────────────────────────────────────────────

auth.initAuthHandlers();
library.initListenerQueueHandlers();
payment.initPaymentHandlers();
payment.initFloatingTip();
player.initShareHandlers();

dashIndex.initDashGateHandlers();
station.initStationHandlers();
bio.initBioHandlers();
vault.initTokenHandlers();
projects.initProjectHandlers();
broadcast.initBroadcastHandlers();
live.initLiveHandlers();
schedule.initScheduleHandlers();
upload.initUploadHandlers();
analytics.initAnalyticsHandlers();
twofa.initTwoFAHandlers();
search.initRadioHostHandlers();

// ── Player-owned top-level DOM listeners ─────────────────────────────────────
// These were never folded into a module export (see player.js header comment
// "Event listeners owned by player (to be wired in main.js, Phase 8)").

el('play-btn').addEventListener('click', player.togglePlay);
el('skip-prev').addEventListener('click', () => player.skipTrack(-1));
el('skip-next').addEventListener('click', () => player.skipTrack(1));
el('back-live-btn').addEventListener('click', player.goLive);
el('lib-btn').addEventListener('click', () => player.toggleDrawer('lib'));
el('queue-btn').addEventListener('click', () => player.toggleDrawer('queue'));
el('share-area').addEventListener('click', player.toggleShare);
el('account-area').addEventListener('click', () => {
  if (state.showLib || state.showQueue) return;
  state.showShare = true;
  player.render();
  setTimeout(() => {
    const authToggle = el('auth-toggle');
    if (authToggle) authToggle.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, 50);
});
el('waveform').addEventListener('click', player.seekWaveform);

// art-flip toggles a CSS class and renders the back face; the "artFlipped"
// flag itself is owned by player.js and not exposed, so the DOM class is used
// as the source of truth here, matching the original inline-script behavior.
el('art-flip').addEventListener('click', () => {
  const flipped = el('art-flip').classList.toggle('flipped');
  if (flipped) player.renderArtBack();
});

// ─── View toggle (PLAY / STUDIO) ────────────────────────────────────────────
document.querySelectorAll('.view-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    const toDash = btn.dataset.view === 'dashboard';
    document.querySelectorAll('.view-tab').forEach(b => b.classList.toggle('active', b === btn));

    if (toDash) {
      // STUDIO: always skip bio page this session
      window._bioSessionPassed = true;
      el('player-card').classList.remove('bio-landing');
      el('player-card').classList.add('dash-active');
      el('topbar-right').style.opacity      = '0';
      el('topbar-right').style.pointerEvents = 'none';
      dashIndex.initDashboard();
    } else {
      // PLAY: only show bio if it hasn't been bypassed this session
      el('player-card').classList.remove('dash-active');
      el('topbar-right').style.opacity      = '1';
      el('topbar-right').style.pointerEvents = '';
    }
  });
});

function enterDashboard() {
  // Bio landing page is PLAY-only — STUDIO always bypasses it this session.
  window._bioSessionPassed = true;
  el('player-card').classList.remove('bio-landing');

  document.querySelectorAll('.view-tab').forEach(b =>
    b.classList.toggle('active', b.dataset.view === 'dashboard'));
  el('player-card').classList.add('dash-active');
  el('topbar-right').style.opacity      = '0';
  el('topbar-right').style.pointerEvents = 'none';
  dashIndex.initDashboard();
}

// ─── Wordmark long-press → creator dashboard ────────────────────────────────
(function() {
  const wordmark = el('pw-wordmark-text');
  let timer = null;
  function start(e) {
    e.preventDefault();
    timer = setTimeout(() => { timer = null; enterDashboard(); }, 600);
  }
  function cancel() { if (timer) { clearTimeout(timer); timer = null; } }
  wordmark.addEventListener('mousedown',   start);
  wordmark.addEventListener('touchstart',  start, { passive: false });
  wordmark.addEventListener('mouseup',     cancel);
  wordmark.addEventListener('mouseleave',  cancel);
  wordmark.addEventListener('touchend',    cancel);
  wordmark.addEventListener('touchcancel', cancel);
})();

// ─── Init ────────────────────────────────────────────────────────────────────
async function init() {
  // Station name
  try {
    const d = await api.stream.health();
    if (d.station) {
      window._stationName = d.station;
      document.title = d.station;
    }
  } catch {}

  // Creator bio landing page (parallel — non-blocking)
  bio.loadBioPanel();

  // Stream status + polling
  await hlsClient.fetchStreamStatus();
  setInterval(hlsClient.fetchStreamStatus, 10_000);

  // Listener auth state — loads before library so gated content is correct first render
  await auth.loadAuthState();

  // Library and queue
  library.loadLibrary();
  library.loadQueue();

  // Tip presets for modal
  payment.loadTipConfig();

  // Silently restore creator session from the httpOnly dashboard cookie.
  // dashboard.initDashboard() is idempotent (guarded by dashboardInitialized)
  // and internally shows either the content view or the auth gate, which
  // replicates the original inline script's silent-restore IIFE.
  dashIndex.initDashboard();

  // Initial render
  player.render();

  // Handle ?tipped=1
  payment.handleTippedParam();

  // Handle ?subscribed=1 — Stripe redirects here after checkout.
  if (new URLSearchParams(location.search).get('subscribed') === '1') {
    history.replaceState(null, '', location.pathname + location.hash);
    if (authState.tier !== 'free' && !authState.hasPassword) {
      state.showShare = true;
      player.render();
      auth.toggleAuthSection(true);
      el('auth-set-pw').hidden = false;
      el('auth-setpw-form').hidden = false;
      setTimeout(() => el('auth-new-password').focus(), 120);
    }
  }
}

init();
