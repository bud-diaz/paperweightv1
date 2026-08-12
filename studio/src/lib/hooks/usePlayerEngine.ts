import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import * as api from '@/lib/api';
import { useMediaSession } from '@/lib/hooks/useMediaSession';
import { useStationIdentity } from '@/lib/hooks/useStationIdentity';

// Ports client/js/hls-client.js's station-playback core (station broadcast +
// audio-only live override, HLS.js setup/retry, stream-status polling, the
// 30s listener ping) into a single hook with a persistent <audio> element.
//
// Paid-tier live VIDEO playback and on-demand/preview track playback (which
// need quota logic) are intentionally out of scope here — this hook only
// drives the always-on station stream, matching Phase 3 Tier 1's scope.
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

export function usePlayerEngine() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const hlsRef = useRef<ReturnType<NonNullable<typeof window.Hls>['prototype']['constructor']> | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const retryAttemptRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);

  const { stationName } = useStationIdentity();
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

  const play = useCallback(() => {
    audioRef.current?.play().catch(() => undefined);
    setPlaying(true);
  }, []);
  const pause = useCallback(() => {
    audioRef.current?.pause();
    setPlaying(false);
  }, []);
  const toggle = useCallback(() => { if (playing) pause(); else play(); }, [playing, play, pause]);

  // Listener keep-alive ping, only while actively playing.
  useEffect(() => {
    if (!playing) return;
    api.stream.ping().catch(() => undefined);
    const id = window.setInterval(() => api.stream.ping().catch(() => undefined), PING_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [playing]);

  const nowPlaying = status?.nowPlaying || null;
  useMediaSession({
    playing,
    title: nowPlaying?.title || stationName,
    artist: nowPlaying?.artist || undefined,
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
  }), [playing, reconnecting, play, pause, toggle, stationName, nowPlaying, status]);
}

export type PlayerEngine = ReturnType<typeof usePlayerEngine>;
