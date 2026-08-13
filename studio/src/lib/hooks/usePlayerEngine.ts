import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import * as api from '@/lib/api';
import { useListenerAuth } from '@/lib/auth/ListenerAuthContext';
import { useMediaSession } from '@/lib/hooks/useMediaSession';
import { useStationIdentity } from '@/lib/hooks/useStationIdentity';

// Ports client/js/hls-client.js's station-playback core into the Studio SPA,
// now with a media-aware surface: audio station/live streams stay on the
// persistent shell-level <audio>, while video station/live/on-demand/preview
// playback uses the visible <video> rendered by PlayerView. On-demand audio
// still uses a separate Audio() object so it can pause/revert to live without
// stealing the HLS station element.

const HLS_URL = '/hls/stream/index.m3u8';
const HLS_LIVE_URL = '/hls/live/index.m3u8';
const HLS_LIVE_VIDEO_URL = '/hls/live-video/index.m3u8';
const STATUS_POLL_MS = 10_000;
const PING_INTERVAL_MS = 30_000;
const HLS_RETRY_DELAYS_MS = [3000, 6000, 12000, 30000];
const PREVIEW_SECS = 30;
const REVERT_TO_LIVE_MS = 30_000;

export type StationTrack = { id: number; title: string; artist: string | null; category: string | null; duration: number | null; isVideo?: boolean };
type NowPlaying = StationTrack & { startedAt?: string | null };
type PlaybackKind = 'audio' | 'video';
type PlaybackSource = 'station' | 'live-audio' | 'live-video';
type ActivePlayback = { source: PlaybackSource; kind: PlaybackKind; url: string };
export type StreamStatus = {
  nowPlaying: NowPlaying | null;
  listenerCount: number;
  liveActive: boolean;
  liveVideoActive?: boolean;
  liveVideoSource?: 'browser' | 'rtmp' | null;
  isVideo: boolean;
  mode: 'shuffle' | 'scheduled';
  stationQueue: StationTrack[];
  recentlyPlayed: (StationTrack & { playedAt: string })[];
};

export type OnDemandTrack = {
  id: number;
  title: string;
  artist: string | null;
  category: string | null;
  duration: number | null;
  visibility: 'public' | 'supporters_only' | 'vault';
  unlocked?: boolean;
  isExternal?: boolean;
  isVideo?: boolean;
  mimeType?: string | null;
};
export type QuotaSnapshot = { limit: number | null; remaining: number | null; resetSec: number; nextUpAvailable?: boolean; emailRequired?: boolean; unlimited?: boolean };

export function isPlayableTrack(track: OnDemandTrack, isPaid: boolean) {
  if (track.isExternal) return false;
  if (track.visibility === 'public') return true;
  if (track.visibility === 'supporters_only') return track.unlocked === true || isPaid;
  if (track.visibility === 'vault') return track.unlocked === true;
  return true;
}

export function usePlayerEngine(options: { isCreatorSession?: boolean; onNotify?: (message: string) => void } = {}) {
  const { isCreatorSession = false, onNotify } = options;
  const audioRef = useRef<HTMLAudioElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<ReturnType<NonNullable<typeof window.Hls>['prototype']['constructor']> | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const retryAttemptRef = useRef(0);
  const activeMediaRef = useRef<HTMLMediaElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);

  const { stationName } = useStationIdentity();
  const { state: listenerAuth } = useListenerAuth();
  const isPaid = isCreatorSession || listenerAuth.tier !== 'free';
  const { data: status } = useQuery<StreamStatus>({ queryKey: ['stream', 'status'], queryFn: () => api.stream.status(), refetchInterval: STATUS_POLL_MS });

  const stationIsVideo = !!(status?.isVideo || status?.nowPlaying?.isVideo);
  const activePlayback = useMemo<ActivePlayback>(() => {
    if (status?.liveVideoActive) return { source: 'live-video', kind: 'video', url: HLS_LIVE_VIDEO_URL };
    if (status?.liveActive) return { source: 'live-audio', kind: 'audio', url: HLS_LIVE_URL };
    return { source: 'station', kind: stationIsVideo ? 'video' : 'audio', url: HLS_URL };
  }, [status?.liveVideoActive, status?.liveActive, stationIsVideo]);
  const activePlaybackKey = `${activePlayback.source}:${activePlayback.kind}:${activePlayback.url}`;

  const clearRetry = useCallback(() => {
    if (retryTimerRef.current !== null) { window.clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
  }, []);

  const detachHls = useCallback(() => {
    if (hlsRef.current) { try { hlsRef.current.destroy(); } catch { /* already destroyed */ } hlsRef.current = null; }
  }, []);

  const mediaForKind = useCallback((kind: PlaybackKind): HTMLMediaElement | null => (
    kind === 'video' ? videoRef.current : audioRef.current
  ), []);

  const stopInactiveElement = useCallback((kind: PlaybackKind) => {
    const inactive = kind === 'video' ? audioRef.current : videoRef.current;
    if (!inactive) return;
    inactive.pause();
    inactive.removeAttribute('src');
    inactive.load?.();
  }, []);

  const attachHls = useCallback((playback: ActivePlayback) => {
    const mediaEl = mediaForKind(playback.kind);
    if (!mediaEl) return;
    detachHls();
    stopInactiveElement(playback.kind);
    activeMediaRef.current = mediaEl;
    if (window.Hls && window.Hls.isSupported()) {
      const hls = new window.Hls({ lowLatencyMode: false });
      hls.loadSource(playback.url);
      hls.attachMedia(mediaEl);
      hlsRef.current = hls;
    } else if (mediaEl.canPlayType('application/vnd.apple.mpegurl')) {
      mediaEl.src = playback.url;
    }
  }, [detachHls, mediaForKind, stopInactiveElement]);

  const scheduleRetry = useCallback(() => {
    if (retryTimerRef.current !== null) return;
    setReconnecting(true);
    const delay = HLS_RETRY_DELAYS_MS[Math.min(retryAttemptRef.current, HLS_RETRY_DELAYS_MS.length - 1)];
    retryAttemptRef.current++;
    retryTimerRef.current = window.setTimeout(() => {
      retryTimerRef.current = null;
      attachHls(activePlayback);
      if (playing) activeMediaRef.current?.play().catch(() => undefined);
    }, delay);
  }, [activePlayback, attachHls, playing]);

  useEffect(() => {
    attachHls(activePlayback);
    return () => {
      clearRetry();
      detachHls();
    };
    // attach once on mount; later source/kind changes are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const hls = hlsRef.current;
    const Hls = window.Hls;
    if (!hls || !Hls) return;
    const onManifestLoaded = () => { clearRetry(); retryAttemptRef.current = 0; setReconnecting(false); };
    const onError = (_event: unknown, data: { fatal?: boolean }) => { if (data?.fatal) scheduleRetry(); };
    hls.on(Hls.Events.MANIFEST_LOADED, onManifestLoaded);
    hls.on(Hls.Events.ERROR, onError);
    return () => {
      hls.off(Hls.Events.MANIFEST_LOADED, onManifestLoaded);
      hls.off(Hls.Events.ERROR, onError);
    };
  }, [activePlaybackKey, clearRetry, scheduleRetry]);

  const prevPlaybackKeyRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (prevPlaybackKeyRef.current === undefined) { prevPlaybackKeyRef.current = activePlaybackKey; return; }
    if (prevPlaybackKeyRef.current === activePlaybackKey) return;
    prevPlaybackKeyRef.current = activePlaybackKey;
    clearRetry();
    retryAttemptRef.current = 0;
    setReconnecting(false);
    attachHls(activePlayback);
    if (playing && !track) activeMediaRef.current?.play().catch(() => setPlaying(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePlaybackKey]);

  // ── On-demand / preview playback ────────────────────────────────────────────
  const [track, setTrack] = useState<OnDemandTrack | null>(null); // non-null = showing on-demand/preview, not live
  const [isPreview, setIsPreview] = useState(false);
  const [odProgress, setOdProgress] = useState(0);
  const [odElapsed, setOdElapsed] = useState(0);
  const [quota, setQuota] = useState<QuotaSnapshot | null>(null);
  const odMediaRef = useRef<HTMLMediaElement | null>(null);
  const previewTimerRef = useRef<number | null>(null);
  const previewTickRef = useRef<number | null>(null);
  const revertTimerRef = useRef<number | null>(null);
  const nextUpRef = useRef<OnDemandTrack | null>(null);

  const refreshQuota = useCallback(async () => {
    if (isPaid) { setQuota(null); return null; }
    try {
      const q = await api.library.streamQuota();
      setQuota(q);
      return q;
    } catch {
      setQuota(null);
      return null;
    }
  }, [isPaid]);

  useEffect(() => { refreshQuota(); }, [refreshQuota]);

  const clearOdTimers = useCallback(() => {
    if (previewTimerRef.current !== null) { window.clearTimeout(previewTimerRef.current); previewTimerRef.current = null; }
    if (previewTickRef.current !== null) { window.clearInterval(previewTickRef.current); previewTickRef.current = null; }
    if (revertTimerRef.current !== null) { window.clearTimeout(revertTimerRef.current); revertTimerRef.current = null; }
  }, []);

  const stopOnDemandMedia = useCallback(() => {
    clearOdTimers();
    if (odMediaRef.current) {
      const media = odMediaRef.current;
      media.pause();
      media.ontimeupdate = null;
      media.onloadedmetadata = null;
      media.onended = null;
      media.onerror = null;
      media.removeAttribute('src');
      media.load?.();
      odMediaRef.current = null;
    }
  }, [clearOdTimers]);

  const pauseLiveMedia = useCallback(() => {
    audioRef.current?.pause();
    videoRef.current?.pause();
  }, []);

  const goLive = useCallback((resume = false) => {
    stopOnDemandMedia();
    setTrack(null);
    setIsPreview(false);
    setOdProgress(0);
    setOdElapsed(0);
    refreshQuota();
    attachHls(activePlayback);
    if (resume) {
      activeMediaRef.current?.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    }
  }, [activePlayback, attachHls, stopOnDemandMedia, refreshQuota]);

  const mediaForOnDemand = useCallback((kind: PlaybackKind) => {
    if (kind === 'video') return videoRef.current;
    return new Audio();
  }, []);

  const configureOnDemandMedia = useCallback((media: HTMLMediaElement, t: OnDemandTrack) => {
    media.onloadedmetadata = () => {
      setOdElapsed(media.currentTime || 0);
      const dur = t.duration || media.duration || 0;
      setOdProgress(dur > 0 ? Math.min((media.currentTime || 0) / dur, 1) : 0);
    };
    media.ontimeupdate = () => {
      setOdElapsed(media.currentTime || 0);
      const dur = t.duration || media.duration || 0;
      setOdProgress(dur > 0 ? Math.min((media.currentTime || 0) / dur, 1) : 0);
    };
  }, []);

  const playPreview = useCallback((t: OnDemandTrack) => {
    stopOnDemandMedia();
    pauseLiveMedia();
    const kind: PlaybackKind = t.isVideo ? 'video' : 'audio';
    stopInactiveElement(kind);
    setTrack(t);
    setIsPreview(true);
    setOdProgress(0);
    setOdElapsed(0);
    setPlaying(false);

    const media = mediaForOnDemand(kind);
    if (!media) { onNotify?.('Video player unavailable. Open Play and try again.'); return; }
    media.src = `/api/library/${t.id}/preview`;
    odMediaRef.current = media;
    configureOnDemandMedia(media, t);
    media.play().then(() => setPlaying(true)).catch(() => setPlaying(false));

    let ticks = 0;
    previewTickRef.current = window.setInterval(() => {
      ticks += 0.25;
      setOdElapsed(Math.min(Math.floor(ticks), PREVIEW_SECS));
      setOdProgress(Math.min(ticks / PREVIEW_SECS, 1));
    }, 250);
    previewTimerRef.current = window.setTimeout(() => { stopOnDemandMedia(); goLive(); }, PREVIEW_SECS * 1000);
    api.events.record('preview_started', { mediaId: t.id, source: 'library' }).catch(() => undefined);
  }, [configureOnDemandMedia, goLive, mediaForOnDemand, onNotify, pauseLiveMedia, stopInactiveElement, stopOnDemandMedia]);

  const playOnDemand = useCallback(async (t: OnDemandTrack, isNextUp = false) => {
    stopOnDemandMedia();
    pauseLiveMedia();
    const kind: PlaybackKind = t.isVideo ? 'video' : 'audio';
    stopInactiveElement(kind);
    setTrack(t);
    setIsPreview(false);
    setOdProgress(0);
    setOdElapsed(0);
    setPlaying(false);

    const media = mediaForOnDemand(kind);
    if (!media) { onNotify?.('Video player unavailable. Open Play and try again.'); return; }
    media.src = api.library.streamUrl(t.id, { nextUp: isNextUp });
    odMediaRef.current = media;
    configureOnDemandMedia(media, t);
    media.onended = () => {
      api.events.record('on_demand_completed', { mediaId: t.id, source: 'library' }).catch(() => undefined);
      stopOnDemandMedia();
      revertTimerRef.current = window.setTimeout(() => goLive(true), REVERT_TO_LIVE_MS);
      setPlaying(false);
      setOdProgress(1);
      setOdElapsed(t.duration || 0);
    };
    media.onerror = () => {
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

    try {
      await media.play();
      setPlaying(true);
      api.events.record('on_demand_started', { mediaId: t.id, source: isNextUp ? 'broadcast' : 'library' }).catch(() => undefined);
      refreshQuota();
    } catch {
      setPlaying(false);
    }
  }, [configureOnDemandMedia, goLive, isPaid, mediaForOnDemand, onNotify, pauseLiveMedia, refreshQuota, stopInactiveElement, stopOnDemandMedia]);

  const selectTrack = useCallback(async (t: OnDemandTrack) => {
    if (t.isExternal) { onNotify?.('External imports are not playable in the web player yet.'); return; }
    if (!isPlayableTrack(t, isPaid)) { playPreview(t); return; }
    await playOnDemand(t, false);
  }, [isPaid, playPreview, playOnDemand, onNotify]);

  // Consume an armed next-up track once the live rotation actually advances
  // (mirrors client/js/player.js's handleNowPlayingChange()).
  const prevNowPlayingIdRef = useRef<number | null>(null);
  useEffect(() => {
    const nextId = status?.nowPlaying?.id ?? null;
    const prevId = prevNowPlayingIdRef.current;
    prevNowPlayingIdRef.current = nextId;
    if (prevId === null || nextId === null || prevId === nextId) return;
    if (!nextUpRef.current || track || odMediaRef.current) return;
    const armed = nextUpRef.current;
    nextUpRef.current = null;
    playOnDemand(armed, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.nowPlaying?.id]);

  useEffect(() => () => { stopOnDemandMedia(); }, [stopOnDemandMedia]);

  // ── Shared transport controls (live + on-demand) ────────────────────────────
  const play = useCallback(() => {
    if (track) { odMediaRef.current?.play().then(() => setPlaying(true)).catch(() => undefined); return; }
    activeMediaRef.current?.play().then(() => setPlaying(true)).catch(() => undefined);
  }, [track]);
  const pause = useCallback(() => {
    if (track) { odMediaRef.current?.pause(); setPlaying(false); return; }
    activeMediaRef.current?.pause();
    setPlaying(false);
  }, [track]);
  const toggle = useCallback(() => { if (playing) pause(); else play(); }, [playing, play, pause]);

  // Counts live station/live-video presence only. On-demand plays are recorded separately.
  useEffect(() => {
    if (!playing || track) return;
    api.stream.ping().catch(() => undefined);
    const id = window.setInterval(() => api.stream.ping().catch(() => undefined), PING_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [playing, track]);

  const nowPlaying = status?.nowPlaying || null;
  const isVideoActive = track ? !!track.isVideo : activePlayback.kind === 'video';
  useMediaSession({
    playing,
    title: track?.title || nowPlaying?.title || stationName,
    artist: track?.artist || nowPlaying?.artist || undefined,
    album: stationName,
    onPlay: play,
    onPause: pause,
  });

  return useMemo(() => ({
    audioRef,
    videoRef,
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
    activeKind: track ? (track.isVideo ? 'video' as const : 'audio' as const) : activePlayback.kind,
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
  }), [activePlayback, isVideoActive, playing, reconnecting, play, pause, toggle, stationName, nowPlaying, status,
    track, isPreview, odProgress, odElapsed, quota, isPaid, selectTrack, goLive]);
}

export type PlayerEngine = ReturnType<typeof usePlayerEngine>;
