import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer, type AudioStatus } from 'expo-audio';
import { createVideoPlayer, type StatusChangeEventPayload, type TimeUpdateEventPayload, type VideoPlayer } from 'expo-video';

import type { StationClient } from '@/api/stationClient';
import {
  isPlayableTrack,
  type ActivePlayback,
  type OnDemandTrack,
  type PlaybackKind,
  type QuotaSnapshot,
  type StreamStatus,
} from '@/player/types';

/**
 * RN analog of studio/src/lib/hooks/usePlayerEngine.ts, built on expo-audio +
 * expo-video (native HLS via AVPlayer/ExoPlayer — no hls.js equivalent
 * needed) instead of the web's <audio>/<video> elements + hls.js. One
 * instance is shared across the whole app via PlayerEngineContext, not
 * created per-screen — see that file for why.
 */

const STATUS_POLL_MS = 10_000;
const PING_INTERVAL_MS = 30_000;
const HLS_RETRY_DELAYS_MS = [3000, 6000, 12000, 30000];
const PREVIEW_SECS = 30;
const REVERT_TO_LIVE_MS = 30_000;

export type PlayerEngineOptions = {
  stationClient: StationClient | null;
  isPaid: boolean;
  stationName: string;
  onNotify?: (message: string) => void;
};

function activePlaybackFor(status: StreamStatus | null, stationClient: StationClient | null): ActivePlayback {
  const hlsUrl = (kind: 'station' | 'live' | 'live-video') => stationClient?.hlsUrl(kind) ?? '';
  if (status?.liveVideoActive) return { source: 'live-video', kind: 'video', url: hlsUrl('live-video') };
  if (status?.liveActive) return { source: 'live-audio', kind: 'audio', url: hlsUrl('live') };
  const stationIsVideo = !!status?.isVideo;
  return { source: 'station', kind: stationIsVideo ? 'video' : 'audio', url: hlsUrl('station') };
}

export function usePlayerEngineState(options: PlayerEngineOptions) {
  const { stationClient, isPaid, stationName, onNotify } = options;

  // ── Persistent players (created once, live for the app's lifetime) ──────
  const audioPlayerRef = useRef<AudioPlayer | null>(null);
  if (audioPlayerRef.current === null) {
    audioPlayerRef.current = createAudioPlayer(null, { updateInterval: 500 });
  }
  const videoPlayerRef = useRef<VideoPlayer | null>(null);
  if (videoPlayerRef.current === null) {
    videoPlayerRef.current = createVideoPlayer(null);
  }

  useEffect(() => {
    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'doNotMix',
    }).catch(() => undefined);
    return () => {
      audioPlayerRef.current?.remove();
      videoPlayerRef.current?.release();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [playing, setPlaying] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);

  // ── Live status polling ──────────────────────────────────────────────────
  const [status, setStatus] = useState<StreamStatus | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async () => {
    if (!stationClient) return;
    try {
      const next = await stationClient.streamStatus();
      setStatus(next);
    } catch {
      // Transient network error — next poll retries; don't clear stale status.
    }
  }, [stationClient]);

  const startPolling = useCallback(() => {
    if (pollTimerRef.current !== null) return;
    pollTimerRef.current = setInterval(fetchStatus, STATUS_POLL_MS);
  }, [fetchStatus]);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current !== null) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    setStatus(null);
    if (!stationClient) return;
    fetchStatus();
    startPolling();
    return stopPolling;
  }, [stationClient, fetchStatus, startPolling, stopPolling]);

  // Background: keep polling only while something is actually playing (the
  // background-audio mode keeps the JS runtime alive specifically for this).
  // Foreground: always resume and catch up immediately.
  const playingRef = useRef(playing);
  playingRef.current = playing;
  useEffect(() => {
    const onChange = (state: AppStateStatus) => {
      if (state === 'active') {
        stopPolling();
        fetchStatus();
        startPolling();
      } else if (!playingRef.current) {
        stopPolling();
      }
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, [fetchStatus, startPolling, stopPolling]);

  const activePlayback = useMemo(() => activePlaybackFor(status, stationClient), [status, stationClient]);
  const activePlaybackKey = `${activePlayback.source}:${activePlayback.kind}:${activePlayback.url}`;

  // ── On-demand / preview playback ─────────────────────────────────────────
  const [track, setTrack] = useState<OnDemandTrack | null>(null);
  const [isPreview, setIsPreview] = useState(false);
  const [odProgress, setOdProgress] = useState(0);
  const [odElapsed, setOdElapsed] = useState(0);
  const [quota, setQuota] = useState<QuotaSnapshot | null>(null);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewTickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const revertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextUpRef = useRef<OnDemandTrack | null>(null);

  // Which player is driving the currently-audible output right now — the
  // on-demand track (if any) always wins over live, and each on-demand track
  // routes to the audio or video player by its own kind.
  const activeKind: PlaybackKind = track ? (track.isVideo ? 'video' : 'audio') : activePlayback.kind;
  const activePlayer = activeKind === 'video' ? videoPlayerRef.current : audioPlayerRef.current;

  const refreshQuota = useCallback(async () => {
    if (isPaid || !stationClient) {
      setQuota(null);
      return null;
    }
    try {
      const q = await stationClient.streamQuota();
      setQuota(q);
      return q;
    } catch {
      setQuota(null);
      return null;
    }
  }, [isPaid, stationClient]);

  useEffect(() => {
    refreshQuota();
  }, [refreshQuota]);

  // Subscriptions attached by playOnDemand/playPreview to whichever player is
  // currently in on-demand mode — since both players are persistent/reused
  // (not a fresh element per track, unlike web), these must be explicitly
  // torn down before attaching a new set, or stale listeners from a
  // previous track keep firing against the new source.
  const odSubsRef = useRef<{ remove: () => void }[]>([]);

  const clearOdTimers = useCallback(() => {
    if (previewTimerRef.current !== null) {
      clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
    if (revertTimerRef.current !== null) {
      clearTimeout(revertTimerRef.current);
      revertTimerRef.current = null;
    }
    if (previewTickRef.current !== null) {
      clearInterval(previewTickRef.current);
      previewTickRef.current = null;
    }
    odSubsRef.current.forEach((s) => s.remove());
    odSubsRef.current = [];
  }, []);

  // ── Live HLS attach + exponential-backoff reconnect ──────────────────────
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryAttemptRef = useRef(0);
  const lastErrorRef = useRef<string | null>(null);

  const clearRetry = useCallback(() => {
    if (retryTimerRef.current !== null) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const attachLive = useCallback(() => {
    if (track) return; // on-demand/preview is showing — don't clobber it
    const headers = stationClient?.authHeader();
    if (activePlayback.kind === 'video') {
      videoPlayerRef.current?.replace({ uri: activePlayback.url, headers });
      if (playingRef.current) videoPlayerRef.current?.play();
    } else {
      audioPlayerRef.current?.replace({ uri: activePlayback.url, headers });
      if (playingRef.current) audioPlayerRef.current?.play();
    }
  }, [activePlayback, stationClient, track]);

  const scheduleRetry = useCallback(() => {
    if (retryTimerRef.current !== null) return;
    setReconnecting(true);
    const delay = HLS_RETRY_DELAYS_MS[Math.min(retryAttemptRef.current, HLS_RETRY_DELAYS_MS.length - 1)];
    retryAttemptRef.current++;
    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = null;
      attachLive();
    }, delay);
  }, [attachLive]);

  const prevPlaybackKeyRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (prevPlaybackKeyRef.current === activePlaybackKey) return;
    prevPlaybackKeyRef.current = activePlaybackKey;
    clearRetry();
    retryAttemptRef.current = 0;
    setReconnecting(false);
    attachLive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePlaybackKey]);

  // Surfaces AudioStatus errors as fatal — same exponential backoff loop as
  // web's hls.js ERROR listener. Live audio only; live-video's equivalent is
  // the statusChange listener below.
  useEffect(() => {
    const player = audioPlayerRef.current;
    if (!player) return;
    const sub = player.addListener('playbackStatusUpdate', (s: AudioStatus) => {
      if (s.error && s.error !== lastErrorRef.current) {
        lastErrorRef.current = s.error;
        if (!track) scheduleRetry();
      } else if (!s.error) {
        lastErrorRef.current = null;
      }
    });
    return () => sub.remove();
  }, [scheduleRetry, track]);

  // expo-video has a different event surface (statusChange, not
  // playbackStatusUpdate) — same fatal-error → backoff-retry intent, applied
  // to live-video only (on-demand video errors are handled inline in
  // playOnDemand below).
  const lastVideoErrorRef = useRef<string | null>(null);
  useEffect(() => {
    const player = videoPlayerRef.current;
    if (!player) return;
    const sub = player.addListener('statusChange', (s: StatusChangeEventPayload) => {
      const message = s.status === 'error' ? s.error?.message || 'error' : null;
      if (message && message !== lastVideoErrorRef.current) {
        lastVideoErrorRef.current = message;
        if (!track) scheduleRetry();
      } else if (!message) {
        lastVideoErrorRef.current = null;
      }
    });
    return () => sub.remove();
  }, [scheduleRetry, track]);

  // ── On-demand track lifecycle ─────────────────────────────────────────────
  const stopOnDemandMedia = useCallback(() => {
    clearOdTimers();
  }, [clearOdTimers]);

  const pauseLiveMedia = useCallback(() => {
    audioPlayerRef.current?.pause();
    videoPlayerRef.current?.pause();
  }, []);

  const goLive = useCallback(
    (resume = false) => {
      stopOnDemandMedia();
      setTrack(null);
      setIsPreview(false);
      setOdProgress(0);
      setOdElapsed(0);
      refreshQuota();
      clearRetry();
      retryAttemptRef.current = 0;
      const headers = stationClient?.authHeader();
      if (activePlayback.kind === 'video') {
        videoPlayerRef.current?.replace({ uri: activePlayback.url, headers });
        if (resume) videoPlayerRef.current?.play();
      } else {
        audioPlayerRef.current?.replace({ uri: activePlayback.url, headers });
        if (resume) audioPlayerRef.current?.play();
      }
      setPlaying(resume);
    },
    [activePlayback, clearRetry, refreshQuota, stationClient, stopOnDemandMedia]
  );

  const playPreview = useCallback(
    (t: OnDemandTrack) => {
      if (!stationClient) return;
      pauseLiveMedia();
      const kind: PlaybackKind = t.isVideo ? 'video' : 'audio';
      setTrack(t);
      setIsPreview(true);
      setOdProgress(0);
      setOdElapsed(0);
      setPlaying(false);

      const headers = stationClient.authHeader();
      const url = stationClient.previewUrl(t.id);
      const player = kind === 'video' ? videoPlayerRef.current : audioPlayerRef.current;
      player?.replace({ uri: url, headers });
      player?.play();
      setPlaying(true);

      let ticks = 0;
      previewTickRef.current = setInterval(() => {
        ticks += 0.25;
        setOdElapsed(Math.min(Math.floor(ticks), PREVIEW_SECS));
        setOdProgress(Math.min(ticks / PREVIEW_SECS, 1));
      }, 250);
      previewTimerRef.current = setTimeout(() => goLive(), PREVIEW_SECS * 1000);
    },
    [goLive, pauseLiveMedia, stationClient]
  );

  const playOnDemand = useCallback(
    async (t: OnDemandTrack, isNextUp = false) => {
      if (!stationClient) return;
      stopOnDemandMedia();
      pauseLiveMedia();
      const kind: PlaybackKind = t.isVideo ? 'video' : 'audio';
      setTrack(t);
      setIsPreview(false);
      setOdProgress(0);
      setOdElapsed(0);
      setPlaying(false);

      const headers = stationClient.authHeader();
      const url = stationClient.streamUrl(t.id, { nextUp: isNextUp });

      const onFinished = () => {
        clearOdTimers(); // removes this call's own listeners too — fine, we're done with them
        revertTimerRef.current = setTimeout(() => goLive(true), REVERT_TO_LIVE_MS);
        setPlaying(false);
        setOdProgress(1);
        setOdElapsed(t.duration || 0);
      };
      const onFailed = () => {
        clearOdTimers();
        (async () => {
          const q = await refreshQuota();
          if (q?.limit && q.remaining === 0) {
            const mins = q.resetSec ? Math.ceil(q.resetSec / 60) : 60;
            if (!isNextUp && !isPaid && q.nextUpAvailable !== false) {
              nextUpRef.current = t;
              onNotify?.(`${q.limit} on-demand plays used. Next-up armed.`);
            } else if (q.emailRequired) {
              onNotify?.('Add your email in Settings for 5 plays/hour.');
            } else {
              onNotify?.(`${q.limit} on-demand plays used this hour. Reset in ${mins} ${mins === 1 ? 'min' : 'mins'}.`);
            }
          } else {
            onNotify?.('Playback unavailable.');
          }
        })();
        goLive(true);
      };

      if (kind === 'video') {
        const player = videoPlayerRef.current;
        if (!player) return;
        player.replace({ uri: url, headers });
        odSubsRef.current.push(
          player.addListener('timeUpdate', (s: TimeUpdateEventPayload) => {
            setOdElapsed(s.currentTime || 0);
            const dur = t.duration || player.duration || 0;
            setOdProgress(dur > 0 ? Math.min((s.currentTime || 0) / dur, 1) : 0);
          }),
          player.addListener('playToEnd', onFinished),
          player.addListener('statusChange', (s: StatusChangeEventPayload) => {
            if (s.status === 'error') onFailed();
          })
        );
        player.play();
      } else {
        const player = audioPlayerRef.current;
        if (!player) return;
        player.replace({ uri: url, headers });
        odSubsRef.current.push(
          player.addListener('playbackStatusUpdate', (s: AudioStatus) => {
            setOdElapsed(s.currentTime || 0);
            const dur = t.duration || s.duration || 0;
            setOdProgress(dur > 0 ? Math.min((s.currentTime || 0) / dur, 1) : 0);
            if (s.didJustFinish) onFinished();
            else if (s.error) onFailed();
          })
        );
        player.play();
      }

      setPlaying(true);
      refreshQuota();
    },
    [goLive, isPaid, onNotify, pauseLiveMedia, refreshQuota, stationClient, stopOnDemandMedia]
  );

  const selectTrack = useCallback(
    async (t: OnDemandTrack) => {
      if (t.isExternal) {
        onNotify?.('External imports are not playable yet.');
        return;
      }
      if (!isPlayableTrack(t, isPaid)) {
        playPreview(t);
        return;
      }
      await playOnDemand(t, false);
    },
    [isPaid, playPreview, playOnDemand, onNotify]
  );

  // Consume an armed next-up track once the live rotation actually advances.
  const prevNowPlayingIdRef = useRef<number | null>(null);
  useEffect(() => {
    const nextId = status?.nowPlaying?.id ?? null;
    const prevId = prevNowPlayingIdRef.current;
    prevNowPlayingIdRef.current = nextId;
    if (prevId === null || nextId === null || prevId === nextId) return;
    if (!nextUpRef.current || track) return;
    const armed = nextUpRef.current;
    nextUpRef.current = null;
    playOnDemand(armed, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.nowPlaying?.id]);

  useEffect(() => () => stopOnDemandMedia(), [stopOnDemandMedia]);

  // ── Shared transport controls (live + on-demand) ─────────────────────────
  const play = useCallback(() => {
    activePlayer?.play();
    setPlaying(true);
  }, [activePlayer]);
  const pause = useCallback(() => {
    activePlayer?.pause();
    setPlaying(false);
  }, [activePlayer]);
  const toggle = useCallback(() => {
    if (playing) pause();
    else play();
  }, [playing, play, pause]);

  // Counts live station/live-video presence only. On-demand plays are
  // recorded server-side via the stream/preview request itself.
  useEffect(() => {
    if (!playing || track || !stationClient) return;
    stationClient.ping().catch(() => undefined);
    const id = setInterval(() => stationClient.ping().catch(() => undefined), PING_INTERVAL_MS);
    return () => clearInterval(id);
  }, [playing, track, stationClient]);

  const nowPlaying = status?.nowPlaying || null;
  const isVideoActive = track ? !!track.isVideo : activePlayback.kind === 'video';

  const getActiveAudioPlayer = useCallback((): AudioPlayer | null => {
    return activeKind === 'audio' ? audioPlayerRef.current : null;
  }, [activeKind]);

  return useMemo(
    () => ({
      playing,
      reconnecting,
      play,
      pause,
      toggle,
      stationName,
      nowPlaying,
      listenerCount: status?.listenerCount ?? 0,
      liveActive: !!status?.liveActive,
      liveVideoActive: !!status?.liveVideoActive,
      activePlayback,
      activeKind,
      isVideoActive,
      stationQueue: status?.stationQueue || [],
      recentlyPlayed: status?.recentlyPlayed || [],
      track,
      isPreview,
      odProgress,
      odElapsed,
      quota,
      isPaid,
      selectTrack,
      goLive,
      getActiveAudioPlayer,
      videoPlayer: videoPlayerRef.current,
    }),
    [
      playing,
      reconnecting,
      play,
      pause,
      toggle,
      stationName,
      nowPlaying,
      status,
      activePlayback,
      activeKind,
      isVideoActive,
      track,
      isPreview,
      odProgress,
      odElapsed,
      quota,
      isPaid,
      selectTrack,
      goLive,
      getActiveAudioPlayer,
    ]
  );
}

export type PlayerEngine = ReturnType<typeof usePlayerEngineState>;
