// Shared state and constants for creator.html — no side effects on import.
// All values mirror the initial inline-script declarations exactly.
// NOTE: ES module live bindings are read-only from importers; reassignment
// patterns like `state = { ...state, ... }` must become Object.assign(state, ...)
// before these exports are consumed (Phase 8).

// ── Config constants ──────────────────────────────────────────────────────────────
export const HLS_URL             = '/hls/stream/index.m3u8';
export const HLS_LIVE_URL        = '/hls/live/index.m3u8';
export const STATUS_INTERVAL_MS  = 10_000;
export const PING_INTERVAL_MS    = 30_000;
export const HLS_RETRY_DELAYS_MS = [3000, 6000, 12000, 30000];
export const PALETTE             = ['#F9C74F','#FF3CAC','#00F5D4','#4CC9F0','#A78BFA'];
export const PREVIEW_SECS        = 30;
export const DAY_NAMES           = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

// ── Playback state ────────────────────────────────────────────────────────────────
export let state = {
  track:         null,   // null = showing live
  playing:       false,
  progress:      0,
  elapsed:       0,
  showLib:       false,
  showQueue:     false,
  showShare:     false,
  sharePanel:    'share', // 'share' | 'account'
  nowPlaying:    null,   // { title, artist } from stream status
  listenerCount: 0,
  isPreview:     false,
};

export let currentIsVideo    = false;
export let currentLiveActive = false;
export let stationName       = '';

// ── Auth state ────────────────────────────────────────────────────────────────────
export let authState = { loggedIn: false, email: '', tier: 'free', hasPassword: false };
export let authTab   = 'login';
export let authOpen  = false;

// ── Library data ──────────────────────────────────────────────────────────────────
export let LIBRARY           = [];
export let LIBRARY_STRUCTURE = { projects: [], standalone: [] };

// ── Tip / payment state ───────────────────────────────────────────────────────────
export let tipAmounts       = [];
export let selectedTipCents = null;

// ── Preview state ─────────────────────────────────────────────────────────────────
export let previewAudio   = null;
export let previewTimer   = null;
export let previewTickInt = null;
export let listenerQueue  = [];

// ── Art card state ────────────────────────────────────────────────────────────────
export let artFlipped      = false;
export let artBackCache    = {};
export let artLastTrackKey = null;

// ── HLS state ─────────────────────────────────────────────────────────────────────
export let hls             = null; // cross-concern global — needs explicit passing
export let hlsRetryTimer   = null;
export let hlsRetryAttempt = 0;
export let statusInterval  = null;
export let pingInterval    = null;

// ── ASCII renderer state ──────────────────────────────────────────────────────────
export const ASCII_DENSITY = " .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$";
export let asciiMode      = null;  // 'audio' | 'video'
export let asciiRafId     = null;
export let asciiAnalyser  = null;
export let asciiAudioCtx  = null;  // cross-concern global — needs explicit passing
export let asciiAudioSrc  = null;
export let asciiArtImg    = null;
export let asciiArtId     = null;  // track id for which asciiArtImg was loaded
export let asciiVidOff    = null;  // offscreen canvas for video frame sampling
export let asciiStartTime = null;  // ms timestamp when audio card animation began

// ── Dashboard state ───────────────────────────────────────────────────────────────
export let dashboardLoaded          = false;
export let dashboardInitialized     = false;
export let bioSessionPassed         = false;
export let pendingChallenge         = null;
export let DASH_ACCOUNTS            = [];
export let vaultStatsBound          = false;
export let _activeVaultPanel        = null;
export let uploadFiles              = [];
export let _analyticsExpandedLoaded = false;
export let currentExtPlatform       = 'youtube';

// ── Live broadcast state ──────────────────────────────────────────────────────────
export let liveAudioCtx    = null;
export let liveWorkletNode = null; // cross-concern global — needs explicit passing
export let liveMediaStream = null;
export let liveTimerInt    = null;
export let liveStartedAt   = 0;
