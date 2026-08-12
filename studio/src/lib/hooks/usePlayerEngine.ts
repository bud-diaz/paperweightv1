import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import * as api from '@/lib/api';
import { useListenerAuth } from '@/lib/auth/ListenerAuthContext';
import { useMediaSession } from '@/lib/hooks/useMediaSession';
import { useStationIdentity } from '@/lib/hooks/useStationIdentity';

// Ports client/js/hls-client.js's station-playback core (station broadcast +
// audio-only live override, HLS.js setup/retry, stream-status polling, the
// 30s listener ping) plus client/js/player.js's on-demand/preview/quota
// logic into a single hook with a persistent <audio> element for the live
// station and a separate plain Audio() object for on-demand/preview tracks
// — mirrors client/js/player.js exactly: on-demand playback has never shared
// the live element with the HLS station stream, it just pauses it.
//
// Paid-tier live VIDEO playback and video-track on-demand/preview are still
// out of scope (no <video> surface wired yet); the personal queue
// (paid-tier "play next queued track on completion") is also deferred —
// on-demand tracks here play once and revert to live, same as the free-tier
// path in the original.
//
// Call this once per shell (AppShell for the creator's own Stack/Play modes,
// ListenerShell for public visitors) and render `audioRef` at the shell root
// so playback survives switching between views — mirrors why
// useLiveBroadcast's capture engine lives above the modal that controls it.

const HLS_URL = '/hls/stream/index.m3u8';
const HLS_LIVE_URL = '/hls/live/index.m3u8';
const STATUS_POLL_MS = 10_000;
const PING_INTERVAL_MS = 30_000;
const HLS_RETRY_DELAYS_MS = [3000, 6000, 12000, 30000];
const PREVIEW_SECS = 30;
const REVERT_TO_LIVE_MS = 30_000;

export type StationTrack = { id: number; title: string; artist: string | null; category: string | null; duration: number | null };
type NowPlaying = StationTrack & { isVideo?: boolean; startedAt?: string | null };
export type StreamStatus = {
  nowPlaying: NowPlaying | null;
  listenerCount: number;
  liveActive: boolean;
  isVideo: boolean;
  mode: 'shuffle' | 'scheduled';
  stationQueue: StationTrack[];
  recentlyPlayed: (StationTrack & { playedAt: string })[];
};

export type OnDemandTrack = { id: number; title: string; artist: string | null; category: string | null; duration: number | null; visibility: 'public' | 'supporters_only' | 'vault'; unlocked?: boolean; isExternal?: boolean };
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
  const hlsRef = useRef<ReturnType<NonNullable<typeof window.Hls>['prototype']['constructor']> | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const retryAttemptRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);

  const { stationName } = useStationIdentity();
  const { state: listenerAuth } = useListenerAuth();
  const isPaid = isCreatorSession || listenerAuth.tier !== 'free';
  const { data: status } = useQuery<StreamStatus>({ queryKey: ['stream', 'status'], queryFn: () => api.stream.status(), refetchInterval: STATUS_POLL_MS });

  const activeUrl = status?.liveActive ? HLS_LIVE_URL : HLS_URL;

  const clearRetry = useCallback(() => {
    if (retryTimerRef.current !== null) { window.clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
  }, []);

  const attachHls = useCallback((url: string) => {
    const audioEl = audioRef.current;
    if (!audioEl) return;
    if (hlsRef.current) { try { hlsRef.current.destroy(); } catch { /* already destroyed */ } hlsRef.current = null; }
    if (window.Hls && window.Hls.isSupported()) {
      const hls = new window.Hls({ lowLatencyMode: false });
      hls.loadSource(url);
      hls.attachMedia(audioEl);
      hlsRef.current = hls;
    } else if (audioEl.canPlayType('application/vnd.apple.mpegurl')) {
      audioEl.src = url;
    }
  }, []);

  const scheduleRetry = useCallback(() => {
    if (retryTimerRef.current !== null) return;
    setReconnecting(true);
    const delay = HLS_RETRY_DELAYS_MS[Math.min(retryAttemptRef.current, HLS_RETRY_DELAYS_MS.length - 1)];
    retryAttemptRef.current++;
    retryTimerRef.current = window.setTimeout(() => {
      retryTimerRef.current = null;
      attachHls(activeUrl);
      if (playing) audioRef.current?.play().catch(() => undefined);
    }, delay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeUrl, attachHls, playing]);

  // Mount: attach HLS once the audio element exists.
  useEffect(() => {
    attachHls(activeUrl);
    return () => {
      clearRetry();
      if (hlsRef.current) { try { hlsRef.current.destroy(); } catch { /* already destroyed */ } hlsRef.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Wire HLS.js error handling once the instance exists (re-runs whenever
  // attachHls recreates it, e.g. after a station/live-override switch).
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
  }, [status?.liveActive, clearRetry, scheduleRetry]);

  // Station broadcast <-> live-audio-override switch while already playing.
  const prevLiveActiveRef = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    if (prevLiveActiveRef.current === undefined) { prevLiveActiveRef.current = status?.liveActive; return; }
    if (prevLiveActiveRef.current === status?.liveActive) return;
    prevLiveActiveRef.current = status?.liveActive;
    clearRetry();
    retryAttemptRef.current = 0;
    setReconnecting(false);
    if (hlsRef.current) {
      hlsRef.current.loadSource(activeUrl);
    } else if (audioRef.current) {
      audioRef.current.src = activeUrl;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.liveActive]);

  // ── On-demand / preview playback (client/js/player.js) ─────────────────────
  const [track, setTrack] = useState<OnDemandTrack | null>(null); // non-null = showing on-demand/preview, not live
  const [isPreview, setIsPreview] = useState(false);
  const [odProgress, setOdProgress] = useState(0);
  const [odElapsed, setOdElapsed] = useState(0);
  const [quota, setQuota] = useState<QuotaSnapshot | null>(null);
  const odMediaRef = useRef<HTMLAudioElement | null>(null);
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
      odMediaRef.current = null;
    }
  }, [clearOdTimers]);

  const goLive = useCallback((resume = false) => {
    stopOnDemandMedia();
    setTrack(null);
    setIsPreview(false);
    setOdProgress(0);
    setOdElapsed(0);
    refreshQuota();
    if (resume) {
      audioRef.current?.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    }
  }, [stopOnDemandMedia, refreshQuota]);

  const playPreview = useCallback((t: OnDemandTrack) => {
    stopOnDemandMedia();
    audioRef.current?.pause();
    setTrack(t);
    setIsPreview(true);
    setOdProgress(0);
    setOdElapsed(0);
    setPlaying(false);

    const media = new Audio(`/api/library/${t.id}/preview`);
    odMediaRef.current = media;
    media.play().catch(() => undefined);

    let ticks = 0;
    previewTickRef.current = window.setInterval(() => {
      ticks += 0.25;
      setOdElapsed(Math.min(Math.floor(ticks), PREVIEW_SECS));
      setOdProgress(Math.min(ticks / PREVIEW_SECS, 1));
    }, 250);
    previewTimerRef.current = window.setTimeout(() => { stopOnDemandMedia(); goLive(); }, PREVIEW_SECS * 1000);
    api.events.record('preview_started', { mediaId: t.id, source: 'library' }).catch(() => undefined);
  }, [stopOnDemandMedia, goLive]);

  const playOnDemand = useCallback(async (t: OnDemandTrack, isNextUp = false) => {
    stopOnDemandMedia();
    audioRef.current?.pause();
    setTrack(t);
    setIsPreview(false);
    setOdProgress(0);
    setOdElapsed(0);
    setPlaying(false);

    const media = new Audio(api.library.streamUrl(t.id, { nextUp: isNextUp }));
    odMediaRef.current = media;

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
  }, [stopOnDemandMedia, goLive, refreshQuota, isPaid, onNotify]);

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
    audioRef.current?.play().catch(() => undefined);
    setPlaying(true);
  }, [track]);
  const pause = useCallback(() => {
    if (track) { odMediaRef.current?.pause(); setPlaying(false); return; }
    audioRef.current?.pause();
    setPlaying(false);
  }, [track]);
  const toggle = useCallback(() => { if (playing) pause(); else play(); }, [playing, play, pause]);

  // Listener keep-alive ping, only while actually playing the live stream.
  useEffect(() => {
    if (!playing || track) return;
    api.stream.ping().catch(() => undefined);
    const id = window.setInterval(() => api.stream.ping().catch(() => undefined), PING_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [playing, track]);

  const nowPlaying = status?.nowPlaying || null;
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
    playing,
    reconnecting,
    play,
    pause,
    toggle,
    stationName,
    nowPlaying,
    listenerCount: status?.listenerCount ?? 0,
    liveActive: !!status?.liveActive,
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
  }), [playing, reconnecting, play, pause, toggle, stationName, nowPlaying, status,
    track, isPreview, odProgress, odElapsed, quota, isPaid, selectTrack, goLive]);
}

export type PlayerEngine = ReturnType<typeof usePlayerEngine>;
