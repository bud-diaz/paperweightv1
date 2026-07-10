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
import { el, esc, fmt } from './utils.js';
import * as api from './api.js';

import * as hlsClient from './hls-client.js';
import * as player    from './player.js';
import * as ascii     from './ascii.js';
import * as auth      from './auth.js';
import * as library      from './library.js';
import * as postsModule  from './posts.js';
import * as libraryModal from './library-modal.js';
import * as payment      from './payment.js';
import * as welcome      from './welcome.js';
import * as collection   from './collection.js';

import * as dashIndex   from './dashboard/index.js';
import * as station     from './dashboard/station.js';
import * as bio         from './dashboard/bio.js';
import * as vault       from './dashboard/vault.js';
import * as projects    from './dashboard/projects.js';
import * as shareLinks  from './dashboard/share.js';
import * as allAccess   from './dashboard/allaccess.js';
import * as broadcast   from './dashboard/broadcast.js';
import * as live        from './dashboard/live.js';
import * as schedule    from './dashboard/schedule.js';
import * as smartPlaylists from './dashboard/smartplaylists.js';
import * as dashPosts   from './dashboard/posts.js';
import * as upload      from './dashboard/upload.js';
import * as analytics   from './dashboard/analytics.js';
import * as twofa       from './dashboard/twofa.js';
import * as sections    from './dashboard/sections.js';
import * as search      from './dashboard/search.js';
import * as tools       from './dashboard/tools.js';
import * as earnings    from './dashboard/earnings.js';

// ── Cross-module callback wiring ─────────────────────────────────────────────

ascii.init({
  isVideoMode:    hlsClient.isVideoMode,
  getStationName: hlsClient.getStationName,
});

auth.init({
  loadLibrary: () => {
    library.loadLibrary();
    postsModule.loadPosts();
    collection.loadCollection();
  },
});

library.init({
  selectVOD:         player.selectVOD,
  startGatedPreview: player.startGatedPreview,
  openModal:         payment.openModal,
  setModalTab:       payment.setModalTab,
  openLibraryModal:  libraryModal.openLibraryModal,
  checkVaultGate:    payment.checkVaultGate,
});

collection.init({
  selectVOD:      player.selectVOD,
  normalizeTrack: library.normalizeTrack,
});

welcome.init({
  onEntered: async () => {
    await auth.loadAuthState();
    library.loadLibrary();
    collection.loadCollection();
  },
  openLogin: () => {
    auth.setAuthTab('login');
    state.showShare = true;
    state.sharePanel = 'account';
    player.render();
    auth.toggleAuthSection(true);
    setTimeout(() => el('auth-email').focus(), 120);
  },
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
  loadDashShareLinks:   shareLinks.loadDashShareLinks,
  loadDashAllAccess:    allAccess.loadDashAllAccess,
  loadDashSmartPlaylists: smartPlaylists.loadDashSmartPlaylists,
  loadDashSchedulePreview: schedule.loadDashSchedulePreview,
  loadDashPosts:           dashPosts.loadDashPosts,
  loadDashSettings:        tools.loadDashSettings,
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

shareLinks.init({
  loadDashLibrary:  vault.loadDashLibrary,
  loadDashProjects: projects.loadDashProjects,
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
smartPlaylists.init();
dashPosts.init();
twofa.init();
sections.init();
tools.init();

// ── Event handler wiring ───────────────────────────────────────────────────

auth.initAuthHandlers();
earnings.initEarningsHandlers();
ascii.initRealVideoToggleHandlers();
library.initListenerQueueHandlers();
libraryModal.initLibraryModalHandlers();
payment.initPaymentHandlers();
payment.initFloatingTip();
player.initShareHandlers();

dashIndex.initDashGateHandlers();
station.initStationHandlers();
bio.initBioHandlers();
vault.initTokenHandlers();
projects.initProjectHandlers();
shareLinks.initShareLinkHandlers();
allAccess.initAllAccessHandlers();
broadcast.initBroadcastHandlers();
live.initLiveHandlers();
schedule.initScheduleHandlers();
smartPlaylists.initSmartPlaylistHandlers();
dashPosts.initPostHandlers();
upload.initUploadHandlers();
analytics.initAnalyticsHandlers();
tools.initToolsHandlers();
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
el('lib-drawer-close').addEventListener('click', e => { e.stopPropagation(); player.toggleDrawer('lib'); });
el('queue-drawer-close').addEventListener('click', e => { e.stopPropagation(); player.toggleDrawer('queue'); });
el('share-area').addEventListener('click', player.toggleShare);
el('account-area').addEventListener('click', () => {
  if (state.showLib || state.showQueue) return;
  const closing = state.showShare && state.sharePanel === 'account';
  state.showShare = !closing;
  state.sharePanel = 'account';
  player.render();
  if (!closing) {
    auth.toggleAuthSection(true);
    setTimeout(() => {
      const authToggle = el('auth-toggle');
      if (authToggle) authToggle.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 50);
  }
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

// ─── Wordmark: long-press → creator dashboard, short press → station search ─
(function() {
  const wordmark  = el('pw-wordmark-text');
  const searchEl  = el('pw-station-search');
  const resultsEl = el('pw-station-results');
  const DIRECTORY_URL = 'https://system.paperweighthq.com/api/modules/paperweight/stations';
  const IDLE_MS = 5000;

  let pressTimer = null;
  let idleTimer = null;
  let debounceTimer = null;
  let activeRequest = 0;

  // Any activity in the field or dropdown re-arms the 5 s idle revert.
  function armIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(closeSearch, IDLE_MS);
  }

  function openSearch() {
    wordmark.hidden = true;
    searchEl.hidden = false;
    searchEl.value = '';
    searchEl.focus();
    armIdle();
  }

  function closeSearch() {
    clearTimeout(idleTimer); idleTimer = null;
    clearTimeout(debounceTimer); debounceTimer = null;
    activeRequest++; // drop any in-flight directory response
    searchEl.hidden = true;
    resultsEl.hidden = true;
    resultsEl.replaceChildren();
    wordmark.hidden = false;
  }

  function note(message) {
    resultsEl.replaceChildren();
    const div = document.createElement('div');
    div.className = 'pw-station-note';
    div.textContent = message;
    resultsEl.appendChild(div);
    resultsEl.hidden = false;
  }

  function validStationUrl(url) {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : null;
    } catch {
      return null;
    }
  }

  function renderStations(stations) {
    resultsEl.replaceChildren();
    for (const station of stations) {
      const parsed = validStationUrl(station.url);
      if (!parsed) continue;
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'pw-station-row';
      const name = document.createElement('span');
      name.textContent = station.name || station.slug || 'Untitled station';
      row.appendChild(name);
      if (station.live) {
        const live = document.createElement('span');
        live.className = 'pw-station-live';
        live.textContent = 'LIVE';
        row.appendChild(live);
      }
      const slug = document.createElement('span');
      slug.className = 'pw-station-slug';
      slug.textContent = station.slug ? `/${station.slug}` : parsed.hostname;
      row.appendChild(slug);
      row.addEventListener('click', () => {
        window.open(parsed.href, '_blank', 'noopener');
        closeSearch();
      });
      resultsEl.appendChild(row);
    }
    if (!resultsEl.children.length) { note('No stations found'); return; }
    resultsEl.hidden = false;
  }

  async function searchStations() {
    const q = searchEl.value.trim();
    if (!q) { resultsEl.hidden = true; resultsEl.replaceChildren(); return; }
    const requestId = ++activeRequest;
    try {
      const url = new URL(DIRECTORY_URL);
      url.searchParams.set('q', q);
      url.searchParams.set('limit', '8');
      const res = await fetch(url.href, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`Directory returned ${res.status}`);
      const data = await res.json();
      if (requestId !== activeRequest) return;
      renderStations(Array.isArray(data.stations) ? data.stations : []);
    } catch {
      if (requestId === activeRequest) note('Directory unavailable');
    }
  }

  // Long press (600 ms) still opens the creator dashboard; releasing earlier
  // counts as a short press and swaps the wordmark for the search field.
  function start(e) {
    e.preventDefault();
    pressTimer = setTimeout(() => { pressTimer = null; enterDashboard(); }, 600);
  }
  function cancel() { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } }
  function release() {
    const shortPress = pressTimer !== null;
    cancel();
    if (shortPress) openSearch();
  }
  wordmark.addEventListener('mousedown',   start);
  wordmark.addEventListener('touchstart',  start, { passive: false });
  wordmark.addEventListener('mouseup',     release);
  wordmark.addEventListener('mouseleave',  cancel);
  wordmark.addEventListener('touchend',    release);
  wordmark.addEventListener('touchcancel', cancel);

  searchEl.addEventListener('input', () => {
    armIdle();
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(searchStations, 300);
  });
  searchEl.addEventListener('focus', armIdle);
  searchEl.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeSearch();
  });
  resultsEl.addEventListener('pointermove', armIdle);
  resultsEl.addEventListener('pointerdown', armIdle);
})();

// ─── Init ────────────────────────────────────────────────────────────────────
function shareTokenFromPath() {
  const match = location.pathname.match(/^\/share\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function showPublicShareShell() {
  const shareView = el('public-share-view');
  if (shareView) shareView.hidden = false;
  const layout = el('layout');
  if (layout) layout.style.display = 'none';
  const credit = el('credit');
  if (credit) credit.style.display = 'none';
  const tip = el('floating-tip');
  if (tip) tip.style.display = 'none';
}

function renderSharedMedia(track) {
  const player = el('public-share-player');
  if (!player) return;
  const tag = track.isVideo ? 'video' : 'audio';
  const title = track.title || `Track #${track.id}`;
  player.innerHTML = `
    <${tag} controls preload="metadata" src="${esc(track.streamUrl || track.previewUrl || '')}" aria-label="${esc(title)}"></${tag}>
  `;
}

function renderPublicShareTracks(tracks) {
  const list = el('public-share-tracks');
  if (!list) return;
  if (tracks.length <= 1) {
    list.innerHTML = '';
    return;
  }
  list.innerHTML = tracks.map((track, index) => `
    <div class="public-share-track">
      <span class="share-target-kind">${index + 1}</span>
      <span class="public-share-track-title">${esc(track.title || `Track #${track.id}`)}</span>
      <span class="share-target-kind">${track.duration ? fmt(track.duration) : ''}</span>
      <button class="public-share-play" type="button" data-share-track-index="${index}">PLAY</button>
    </div>
  `).join('');
  list.querySelectorAll('[data-share-track-index]').forEach(btn => {
    btn.addEventListener('click', () => {
      const track = tracks[parseInt(btn.dataset.shareTrackIndex, 10)];
      if (track) renderSharedMedia(track);
    });
  });
}

async function maybeRenderPublicShare() {
  const token = shareTokenFromPath();
  if (!token) return false;
  showPublicShareShell();
  try {
    const data = await api.share.resolve(token);
    if (data.error) throw new Error(data.error);
    const collection = data.collection || data.project || null;
    const tracks = data.track ? [data.track] : (collection?.tracks || []);
    if (!tracks.length) throw new Error('Shared content unavailable');
    const title = data.label || data.track?.title || collection?.name || 'Shared content';
    el('public-share-title').textContent = title;
    el('public-share-subtitle').textContent = collection
      ? `${collection.tracks.length} track${collection.tracks.length === 1 ? '' : 's'} in this collection${collection.description ? ' / ' + collection.description : ''}`
      : [data.track?.artist, data.track?.category].filter(Boolean).join(' / ');
    if (tracks[0]) renderSharedMedia(tracks[0]);
    renderPublicShareTracks(tracks);
    el('public-share-foot').textContent = data.expiresAt
      ? `Expires ${new Date(data.expiresAt).toLocaleString()}`
      : 'No expiration set.';
  } catch {
    el('public-share-title').textContent = 'Share unavailable';
    el('public-share-subtitle').textContent = 'This link is expired, revoked, or the shared content is no longer available.';
    el('public-share-player').innerHTML = '';
    el('public-share-tracks').innerHTML = '';
    el('public-share-foot').textContent = '';
  }
  return true;
}

async function init() {
  if (await maybeRenderPublicShare()) return;

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
  postsModule.loadBioMessages();

  // Stream status + polling
  await hlsClient.fetchStreamStatus();
  setInterval(hlsClient.fetchStreamStatus, 10_000);

  // Listener auth state — loads before library so gated content is correct first render
  await auth.loadAuthState();

  // First-visit welcome page (display-name-only entry, Papercut-style).
  // After loadAuthState so returning listeners are never re-prompted.
  welcome.maybeShowWelcome(window._stationName || '');

  // Library and queue
  library.loadLibrary();
  library.loadQueue();
  postsModule.loadPosts();
  collection.loadCollection();

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
      state.sharePanel = 'account';
      player.render();
      auth.toggleAuthSection(true);
      el('auth-set-pw').hidden = false;
      el('auth-setpw-form').hidden = false;
      setTimeout(() => el('auth-new-password').focus(), 120);
    }
  }
}

init();
