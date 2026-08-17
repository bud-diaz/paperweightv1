import { BottomSheetModal } from '@gorhom/bottom-sheet';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  hlsLiveAudioUrl,
  hlsStationUrl,
  libraryArtworkUrl,
  libraryPreviewUrl,
  libraryStreamUrl,
  type NowPlayingTrack,
  type RecentlyPlayedTrack,
  type StationTrack,
  type StreamStatus,
} from '@/api/stationClient';
import { useStationClient, useStationStore } from '@/state/stationStore';

const STATUS_POLL_MS = 10_000;
const PING_INTERVAL_MS = 30_000;
const PREVIEW_SECS = 30;
const REVERT_TO_LIVE_MS = 30_000;

export type OnDemandTrack = {
  id: number;
  title: string;
  artist: string | null;
  category: string | null;
  duration: number | null;
  visibility: 'public' | 'supporters_only' | 'vault';
  unlocked?: boolean;
  isExternal?: boolean;
};

/**
 * Mirrors studio/src/lib/hooks/usePlayerEngine.ts's isPlayableTrack exactly.
 * Not exercised by any Phase 3 UI yet (no track-selection surface exists
 * until Phase 4's Stack catalog) — kept here so selectTrack is ready to call
 * without PlayerEngine needing rework then.
 */
export function isPlayableTrack(track: OnDemandTrack, isPaid: boolean): boolean {
  if (track.isExternal) return false;
  if (track.visibility === 'public') return true;
  if (track.visibility === 'supporters_only') return track.unlocked === true || isPaid;
  if (track.visibility === 'vault') return track.unlocked === true;
  return true;
}

export type ActiveSourceKind = 'none' | 'live-audio' | 'station' | 'on-demand';

type PlayerEngineValue = {
  hasStation: boolean;
  stationName: string | null;
  status: StreamStatus | null;
  nowPlaying: NowPlayingTrack | null;
  listenerCount: number;
  liveActive: boolean;
  stationQueue: StationTrack[];
  recentlyPlayed: RecentlyPlayedTrack[];
  track: OnDemandTrack | null;
  isPreview: boolean;
  playing: boolean;
  isBuffering: boolean;
  error: string | null;
  odProgress: number;
  odElapsed: number;
  odDuration: number;
  activeSourceKind: ActiveSourceKind;
  nowPlayingArtworkUrl: string | null;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  selectTrack: (track: OnDemandTrack, isPaid: boolean) => void;
  goLive: (resume?: boolean) => void;
  /** Seeks within the current on-demand track only — no-op for live/station audio (no seekable position). */
  seekOnDemand: (seconds: number) => void;
  /** Replay-on-finish for the current on-demand track only; resets whenever `goLive`/a new `selectTrack` starts. */
  repeatOnDemand: boolean;
  toggleRepeatOnDemand: () => void;
  bigPlayButtonVisible: boolean;
  setBigPlayButtonVisible: (visible: boolean) => void;
  drawerRef: React.RefObject<BottomSheetModal | null>;
  openDrawer: () => void;
  closeDrawer: () => void;
};

const PlayerEngineContext = createContext<PlayerEngineValue | null>(null);

export function PlayerEngineProvider({ children }: { children: ReactNode }) {
  const { baseUrl, station, listenerAuth } = useStationStore();
  const client = useStationClient();

  const [status, setStatus] = useState<StreamStatus | null>(null);
  const [track, setTrack] = useState<OnDemandTrack | null>(null);
  const [isPreview, setIsPreview] = useState(false);
  const [bigPlayButtonVisible, setBigPlayButtonVisible] = useState(true);
  const [repeatOnDemand, setRepeatOnDemand] = useState(false);

  const player = useAudioPlayer(null, { updateInterval: 500 });
  const playerStatus = useAudioPlayerStatus(player);

  const loadedUrlRef = useRef<string | null>(null);
  const playingIntentRef = useRef(false);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revertScheduledRef = useRef(false);
  const prevBaseUrlRef = useRef(baseUrl);
  const drawerRef = useRef<BottomSheetModal>(null);
  const lockScreenActiveRef = useRef(false);

  const clearPreviewTimer = useCallback(() => {
    if (previewTimerRef.current) {
      clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
  }, []);

  const goLive = useCallback(
    (resume = false) => {
      clearPreviewTimer();
      revertScheduledRef.current = false;
      setTrack(null);
      setIsPreview(false);
      setRepeatOnDemand(false);
      playingIntentRef.current = resume;
    },
    [clearPreviewTimer]
  );

  const seekOnDemand = useCallback(
    (seconds: number) => {
      if (!track) return;
      player.seekTo(Math.max(0, seconds)).catch(() => {});
    },
    [track, player]
  );

  const toggleRepeatOnDemand = useCallback(() => setRepeatOnDemand((v) => !v), []);

  const selectTrack = useCallback(
    (t: OnDemandTrack, isPaid: boolean) => {
      clearPreviewTimer();
      revertScheduledRef.current = false;
      if (t.isExternal) return;
      if (!isPlayableTrack(t, isPaid)) {
        setTrack(t);
        setIsPreview(true);
        playingIntentRef.current = true;
        previewTimerRef.current = setTimeout(() => {
          goLive(false);
        }, PREVIEW_SECS * 1000);
        return;
      }
      setTrack(t);
      setIsPreview(false);
      playingIntentRef.current = true;
    },
    [clearPreviewTimer, goLive]
  );

  const play = useCallback(() => {
    playingIntentRef.current = true;
    player.play();
  }, [player]);

  const pause = useCallback(() => {
    playingIntentRef.current = false;
    player.pause();
  }, [player]);

  const toggle = useCallback(() => {
    if (playerStatus.playing) pause();
    else play();
  }, [playerStatus.playing, play, pause]);

  const openDrawer = useCallback(() => drawerRef.current?.present(), []);
  const closeDrawer = useCallback(() => drawerRef.current?.dismiss(), []);

  // Reset on-demand state and pause whenever the effective station changes
  // (new selection or manual-URL override) — a stale track from the
  // previous station should never keep playing.
  useEffect(() => {
    if (prevBaseUrlRef.current === baseUrl) return;
    prevBaseUrlRef.current = baseUrl;
    clearPreviewTimer();
    revertScheduledRef.current = false;
    setTrack(null);
    setIsPreview(false);
    setStatus(null);
    playingIntentRef.current = false;
    lockScreenActiveRef.current = false;
    player.pause();
  }, [baseUrl, clearPreviewTimer, player]);

  // Poll /api/stream/status every 10s while a station is selected — drives
  // now-playing/queue/recently-played display independent of playback state,
  // matching the web engine's always-on react-query interval.
  useEffect(() => {
    if (!client) {
      setStatus(null);
      return;
    }
    let cancelled = false;
    const poll = () => {
      client
        .streamStatus()
        .then((s) => {
          if (!cancelled) setStatus(s);
        })
        .catch(() => {});
    };
    poll();
    const id = setInterval(poll, STATUS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [client]);

  const desiredSource = useMemo(() => {
    if (!baseUrl) return null;
    if (track) {
      return { url: isPreview ? libraryPreviewUrl(baseUrl, track.id) : libraryStreamUrl(baseUrl, track.id) };
    }
    if (status?.liveActive) return { url: hlsLiveAudioUrl(baseUrl) };
    return { url: hlsStationUrl(baseUrl) };
  }, [baseUrl, track, isPreview, status?.liveActive]);

  // Swap the player's source whenever the desired URL actually changes, and
  // resume playback afterward only if the user's play intent was already
  // true — an automatic live<->station swap shouldn't start playback on its
  // own, but should keep it going if it was already playing.
  useEffect(() => {
    if (!desiredSource) {
      if (loadedUrlRef.current !== null) {
        player.pause();
        player.replace(null);
        loadedUrlRef.current = null;
      }
      return;
    }
    if (loadedUrlRef.current === desiredSource.url) return;
    loadedUrlRef.current = desiredSource.url;
    const headers = listenerAuth?.token ? { Authorization: `Bearer ${listenerAuth.token}` } : undefined;
    player.replace({ uri: desiredSource.url, headers });
    if (playingIntentRef.current) player.play();
  }, [desiredSource, listenerAuth, player]);

  // On-demand track finished naturally: if repeat is on, loop it in place;
  // otherwise give the "just finished" state a moment to render, then
  // return to live, matching the web engine's 30s-after-onended revert.
  useEffect(() => {
    if (!track || isPreview || !playerStatus.didJustFinish || revertScheduledRef.current) return;
    if (repeatOnDemand) {
      player.seekTo(0).then(() => player.play());
      return;
    }
    revertScheduledRef.current = true;
    const timer = setTimeout(() => goLive(true), REVERT_TO_LIVE_MS);
    return () => clearTimeout(timer);
  }, [track, isPreview, playerStatus.didJustFinish, goLive, repeatOnDemand, player]);

  // On-demand playback failed (vault/tier 403, quota 429, network) — fall
  // back to live rather than sitting on a dead player. No next-up arming or
  // quota display yet (unreachable without Phase 4's track-selection UI).
  useEffect(() => {
    if (track && playerStatus.error) goLive(true);
  }, [track, playerStatus.error, goLive]);

  // Lock-screen / notification media controls. Android requires this call
  // (not just background audio permissions) for playback to survive past
  // ~3 minutes backgrounded — see expo-audio's AudioPlayer.setActiveForLockScreen docs.
  // Only *activates* once per playback-start (ref-gated) and uses
  // updateLockScreenMetadata for subsequent metadata-only changes, both
  // because that's the API's documented usage and because re-calling
  // setActiveForLockScreen on every status poll was found (real-device
  // testing) to hammer the native call far more than intended. In Expo Go
  // specifically this call always fails — Expo Go can't run our config
  // plugin's Android media-session service registration, so there's no
  // service to bind to — hence the try/catch; it works in a real dev-client
  // or production build, where the plugin has actually run at prebuild time.
  useEffect(() => {
    if (!playerStatus.playing) return;
    const nowPlaying = status?.nowPlaying ?? null;
    const title = track?.title ?? nowPlaying?.title ?? station?.name ?? 'Live';
    const artist = (track ? track.artist : nowPlaying?.artist) ?? undefined;
    const artworkTrackId = track?.id ?? nowPlaying?.id;
    const artworkUrl = baseUrl && artworkTrackId != null ? libraryArtworkUrl(baseUrl, artworkTrackId) : undefined;
    const metadata = { title, artist, albumTitle: station?.name ?? undefined, artworkUrl };
    try {
      if (lockScreenActiveRef.current) {
        player.updateLockScreenMetadata(metadata);
      } else {
        player.setActiveForLockScreen(true, metadata);
        lockScreenActiveRef.current = true;
      }
    } catch {
      // Best-effort — see comment above (expected to fail under Expo Go).
    }
  }, [playerStatus.playing, track, status?.nowPlaying, station?.name, baseUrl, player]);

  useEffect(() => {
    if (baseUrl || !lockScreenActiveRef.current) return;
    lockScreenActiveRef.current = false;
    try {
      player.clearLockScreenControls();
    } catch {
      // Best-effort — see comment above.
    }
  }, [baseUrl, player]);

  useEffect(() => {
    return () => {
      try {
        player.clearLockScreenControls();
      } catch {
        // Best-effort — see comment above.
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Listener presence ping while live/station audio is actually playing —
  // on-demand plays don't count toward the live listener count, matching web.
  useEffect(() => {
    if (!client || !playerStatus.playing || track) return;
    client.ping().catch(() => {});
    const id = setInterval(() => client.ping().catch(() => {}), PING_INTERVAL_MS);
    return () => clearInterval(id);
  }, [client, playerStatus.playing, track]);

  const odDuration = track ? (track.duration ?? playerStatus.duration) : 0;
  const odElapsed = track ? playerStatus.currentTime : 0;
  const odProgress = odDuration > 0 ? Math.min(1, odElapsed / odDuration) : 0;

  const activeSourceKind: ActiveSourceKind = !baseUrl
    ? 'none'
    : track
      ? 'on-demand'
      : status?.liveActive
        ? 'live-audio'
        : 'station';

  const nowPlayingArtworkUrl =
    baseUrl && status?.nowPlaying ? libraryArtworkUrl(baseUrl, status.nowPlaying.id) : null;

  const value = useMemo<PlayerEngineValue>(
    () => ({
      hasStation: !!baseUrl,
      stationName: station?.name ?? null,
      status,
      nowPlaying: status?.nowPlaying ?? null,
      listenerCount: status?.listenerCount ?? 0,
      liveActive: !!status?.liveActive,
      stationQueue: status?.stationQueue ?? [],
      recentlyPlayed: status?.recentlyPlayed ?? [],
      track,
      isPreview,
      playing: playerStatus.playing,
      isBuffering: playerStatus.isBuffering,
      error: playerStatus.error,
      odProgress,
      odElapsed,
      odDuration,
      activeSourceKind,
      nowPlayingArtworkUrl,
      play,
      pause,
      toggle,
      selectTrack,
      goLive,
      seekOnDemand,
      repeatOnDemand,
      toggleRepeatOnDemand,
      bigPlayButtonVisible,
      setBigPlayButtonVisible,
      drawerRef,
      openDrawer,
      closeDrawer,
    }),
    [
      baseUrl,
      station?.name,
      status,
      track,
      isPreview,
      playerStatus.playing,
      playerStatus.isBuffering,
      playerStatus.error,
      odProgress,
      odElapsed,
      odDuration,
      activeSourceKind,
      nowPlayingArtworkUrl,
      play,
      pause,
      toggle,
      selectTrack,
      goLive,
      seekOnDemand,
      repeatOnDemand,
      toggleRepeatOnDemand,
      bigPlayButtonVisible,
      openDrawer,
      closeDrawer,
    ]
  );

  return <PlayerEngineContext.Provider value={value}>{children}</PlayerEngineContext.Provider>;
}

export function usePlayerEngine(): PlayerEngineValue {
  const ctx = useContext(PlayerEngineContext);
  if (!ctx) throw new Error('usePlayerEngine must be used within a PlayerEngineProvider');
  return ctx;
}
