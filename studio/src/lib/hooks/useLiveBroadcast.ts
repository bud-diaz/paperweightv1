import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import * as api from '@/lib/api';

// Ports client/js/dashboard/live.js, live-external.js, and liveVideo.js into
// one hook. The real engine state (AudioContext/AudioWorkletNode/MediaStream
// for mic capture, MediaStream/MediaRecorder for camera capture) is owned
// here, at the AppShell level, rather than inside the modal component —
// closing the "Go live" modal must NOT stop an in-progress broadcast, exactly
// like the vanilla dashboard's golive.js only ever toggles the overlay.
// AppShell calls this hook once; the modal (and the Broadcast hero) just
// read/drive it through props.

export type RtmpInfo = { host: string; port: number; streamKey: string; url: string } | null;
export type LiveAudioStatus = { isLive: boolean; source: 'mic' | 'rtmp' | null; startedAt: string | null; rtmpPending: boolean; rtmpPort: number | null };
export type ExternalAudioStatus = { state: 'idle' | 'pending' | 'live'; startedAt: string | null; rtmp: RtmpInfo };
export type LiveVideoStatus = { state: 'idle' | 'pending' | 'live'; source: 'browser' | 'rtmp' | null; startedAt: string | null; rtmp: RtmpInfo };
export type LiveVideoSettings = { minTier: 'subscriber' | 'pro' | 'all_access'; notifyEnabled: boolean };

type ActionState = { pending: boolean; error: string | null };
const IDLE: ActionState = { pending: false, error: null };

const STATUS_POLL_MS = 4000;

function pickSupportedVideoMimeType(): string | null {
  const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  return candidates.find((type) => window.MediaRecorder && MediaRecorder.isTypeSupported(type)) || null;
}

export function useLiveBroadcast(notify: (message: string) => void) {
  const queryClient = useQueryClient();

  const { data: platform } = useQuery<{ platform: 'desktop' | 'web' }>({ queryKey: ['system', 'platform'], queryFn: () => api.dashboard.system.platform() });
  const isDesktop = platform?.platform === 'desktop';

  const { data: audioStatus } = useQuery<LiveAudioStatus>({ queryKey: ['dashboard', 'live', 'status'], queryFn: () => api.dashboard.live.status(), refetchInterval: STATUS_POLL_MS });
  const { data: externalAudioStatus } = useQuery<ExternalAudioStatus>({ queryKey: ['dashboard', 'broadcast', 'external', 'status'], queryFn: () => api.dashboard.broadcastExternal.status(), refetchInterval: STATUS_POLL_MS, enabled: isDesktop });
  const { data: videoStatus } = useQuery<LiveVideoStatus>({ queryKey: ['dashboard', 'live-video', 'status'], queryFn: () => api.dashboard.liveVideo.status(), refetchInterval: STATUS_POLL_MS });
  const { data: videoSettings } = useQuery<LiveVideoSettings>({ queryKey: ['dashboard', 'live-video', 'settings'], queryFn: () => api.dashboard.liveVideo.settings() });

  const invalidateAudio = () => {
    queryClient.invalidateQueries({ queryKey: ['dashboard', 'live', 'status'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard', 'broadcast', 'external', 'status'] });
  };
  const invalidateVideo = () => queryClient.invalidateQueries({ queryKey: ['dashboard', 'live-video', 'status'] });

  // ── Audio: mic capture engine (persists across modal open/close) ──────────
  const micCtxRef = useRef<AudioContext | null>(null);
  const micWorkletRef = useRef<AudioWorkletNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const [micLocalActive, setMicLocalActive] = useState(false);
  const [micState, setMicState] = useState<ActionState>(IDLE);
  const [externalAudioState, setExternalAudioState] = useState<ActionState>(IDLE);
  // Set once startMic() has confirmed the server actually kept the broadcast
  // alive (ffmpeg can die asynchronously right after spawn — e.g. if it's not
  // installed — after the start request already returned 200). Gates the
  // watchdog effect below so it never reacts to the stale pre-start cache.
  const micConfirmedRef = useRef(false);

  async function teardownMicLocal() {
    if (micWorkletRef.current) { try { micWorkletRef.current.disconnect(); } catch { /* already disconnected */ } micWorkletRef.current = null; }
    if (micCtxRef.current) { await micCtxRef.current.close().catch(() => undefined); micCtxRef.current = null; }
    if (micStreamRef.current) { micStreamRef.current.getTracks().forEach((track) => track.stop()); micStreamRef.current = null; }
    micAnalyserRef.current = null;
    micConfirmedRef.current = false;
    setMicLocalActive(false);
  }

  async function startMic() {
    if (micState.pending) return;
    setMicState({ pending: true, error: null });

    try {
      micStreamRef.current = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 44100, channelCount: 1, echoCancellation: false, noiseSuppression: false },
        video: false,
      });
    } catch (err) {
      setMicState({ pending: false, error: `Mic access denied: ${(err as Error).message}` });
      return;
    }

    const { res, data } = await api.dashboard.live.start() as { res: Response; data: { error?: string } };
    if (!res.ok) {
      setMicState({ pending: false, error: data.error || 'Could not start live session' });
      micStreamRef.current.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
      return;
    }

    const ctx = new AudioContext({ sampleRate: 44100 });
    try {
      await ctx.audioWorklet.addModule('/js/worklet-processor.js');
    } catch (err) {
      setMicState({ pending: false, error: `AudioWorklet error: ${(err as Error).message}` });
      await ctx.close().catch(() => undefined);
      micStreamRef.current?.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
      await api.dashboard.live.stop().catch(() => undefined);
      invalidateAudio();
      return;
    }

    const source = ctx.createMediaStreamSource(micStreamRef.current);
    const worklet = new AudioWorkletNode(ctx, 'pw-pcm');
    source.connect(worklet);

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.75;
    source.connect(analyser);

    worklet.port.onmessage = (event: MessageEvent<Float32Array>) => {
      const f32 = event.data;
      const i16 = new Int16Array(f32.length);
      for (let i = 0; i < f32.length; i++) i16[i] = Math.max(-1, Math.min(1, f32[i])) * 0x7fff;
      api.dashboard.live.sendChunk(i16.buffer).catch(() => undefined);
    };

    micCtxRef.current = ctx;
    micWorkletRef.current = worklet;
    micAnalyserRef.current = analyser;
    setMicLocalActive(true);

    // Confirm the server actually kept the broadcast alive before declaring
    // success — await the invalidated refetch so this reflects real
    // post-start state rather than the stale pre-start cache.
    await queryClient.invalidateQueries({ queryKey: ['dashboard', 'live', 'status'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard', 'broadcast', 'external', 'status'] });
    const fresh = queryClient.getQueryData<LiveAudioStatus>(['dashboard', 'live', 'status']);
    if (!fresh?.isLive) {
      await teardownMicLocal();
      setMicState({ pending: false, error: 'The broadcast stopped right after starting — check the server logs (ffmpeg may be missing) and try again.' });
      return;
    }

    micConfirmedRef.current = true;
    setMicState({ pending: false, error: null });
  }

  async function stopAudio() {
    await teardownMicLocal();
    try { await api.dashboard.live.stop(); } catch { /* best-effort */ }
    invalidateAudio();
  }

  // Watchdog: if the server-reported broadcast state goes non-live while this
  // tab still thinks it's actively capturing the mic (e.g. ffmpeg crashes
  // mid-broadcast), release the mic and surface it instead of silently
  // uploading doomed chunks forever.
  useEffect(() => {
    if (!micLocalActive || !micConfirmedRef.current) return;
    if (audioStatus && !audioStatus.isLive) {
      teardownMicLocal();
      setMicState({ pending: false, error: 'Broadcast ended unexpectedly on the server.' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [micLocalActive, audioStatus]);

  async function startExternalAudio() {
    setExternalAudioState({ pending: true, error: null });
    try {
      const { res, data } = await api.dashboard.broadcastExternal.start() as { res: Response; data: { error?: string } };
      if (!res.ok) {
        setExternalAudioState({ pending: false, error: data.error || 'Could not start external broadcast' });
        return;
      }
      setExternalAudioState({ pending: false, error: null });
      invalidateAudio();
    } catch {
      setExternalAudioState({ pending: false, error: 'Server error — try again' });
    }
  }

  async function regenerateExternalAudioKey() {
    const { res, data } = await api.dashboard.broadcastExternal.regenerateKey() as { res: Response; data: { error?: string; streamKey?: string } };
    if (!res.ok) { notify(data.error || 'Could not regenerate key.'); return; }
    invalidateAudio();
    notify('Stream key regenerated.');
  }

  // ── Video: browser (camera) capture engine ─────────────────────────────────
  const videoStreamRef = useRef<MediaStream | null>(null);
  const videoRecorderRef = useRef<MediaRecorder | null>(null);
  const [videoLocalActive, setVideoLocalActive] = useState(false);
  const [videoState, setVideoState] = useState<ActionState>(IDLE);
  const videoConfirmedRef = useRef(false);

  function teardownVideoLocal() {
    if (videoRecorderRef.current && videoRecorderRef.current.state !== 'inactive') {
      try { videoRecorderRef.current.stop(); } catch { /* already stopped */ }
    }
    videoRecorderRef.current = null;
    if (videoStreamRef.current) { videoStreamRef.current.getTracks().forEach((track) => track.stop()); videoStreamRef.current = null; }
    videoConfirmedRef.current = false;
    setVideoLocalActive(false);
  }

  async function stopVideo() {
    teardownVideoLocal();
    try { await api.dashboard.liveVideo.stop(); } catch { /* best-effort */ }
    invalidateVideo();
  }

  async function startVideoBrowser() {
    if (videoState.pending) return;
    setVideoState({ pending: true, error: null });

    try {
      videoStreamRef.current = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch (err) {
      setVideoState({ pending: false, error: `Camera/mic access denied: ${(err as Error).message}` });
      return;
    }
    setVideoLocalActive(true);

    const mimeType = pickSupportedVideoMimeType();
    if (!mimeType) {
      setVideoState({ pending: false, error: 'Your browser cannot record video in a supported format.' });
      teardownVideoLocal();
      return;
    }

    const { res, data } = await api.dashboard.liveVideo.startBrowser() as { res: Response; data: { error?: string } };
    if (!res.ok) {
      setVideoState({ pending: false, error: data.error || 'Could not start live video broadcast' });
      teardownVideoLocal();
      return;
    }

    const recorder = new MediaRecorder(videoStreamRef.current, {
      mimeType,
      videoBitsPerSecond: 2_000_000,
      audioBitsPerSecond: 128_000,
    });
    recorder.ondataavailable = (event) => {
      if (event.data?.size) api.dashboard.liveVideo.sendChunk(event.data).catch(() => undefined);
    };
    recorder.onerror = () => {
      setVideoState((prev) => ({ ...prev, error: 'Recording error — ending broadcast' }));
      stopVideo();
    };
    videoStreamRef.current.getVideoTracks()[0].onended = () => stopVideo();
    recorder.start(1000);
    videoRecorderRef.current = recorder;

    // Same post-start confirmation as startMic() — ffmpeg can die
    // asynchronously right after the start request already returned 200.
    await queryClient.invalidateQueries({ queryKey: ['dashboard', 'live-video', 'status'] });
    const fresh = queryClient.getQueryData<LiveVideoStatus>(['dashboard', 'live-video', 'status']);
    if (fresh?.state !== 'live') {
      teardownVideoLocal();
      setVideoState({ pending: false, error: 'The broadcast stopped right after starting — check the server logs (ffmpeg may be missing) and try again.' });
      return;
    }

    videoConfirmedRef.current = true;
    setVideoState({ pending: false, error: null });
  }

  async function startVideoRtmp() {
    if (videoState.pending) return;
    setVideoState({ pending: true, error: null });
    try {
      const { res, data } = await api.dashboard.liveVideo.start() as { res: Response; data: { error?: string } };
      if (!res.ok) {
        setVideoState({ pending: false, error: data.error || 'Could not start live video broadcast' });
        return;
      }
      setVideoState({ pending: false, error: null });
      invalidateVideo();
    } catch {
      setVideoState({ pending: false, error: 'Server error — try again' });
    }
  }

  async function regenerateVideoKey() {
    const { res, data } = await api.dashboard.liveVideo.regenerateKey() as { res: Response; data: { error?: string; streamKey?: string } };
    if (!res.ok) { notify(data.error || 'Could not regenerate key.'); return; }
    invalidateVideo();
    notify('Stream key regenerated.');
  }

  async function saveVideoSettings(next: Partial<LiveVideoSettings>) {
    try {
      await api.dashboard.liveVideo.updateSettings(next);
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'live-video', 'settings'] });
    } catch { /* best-effort, matches vanilla liveVideo.js */ }
  }

  // Watchdog counterpart to the mic one above, for browser camera capture.
  useEffect(() => {
    if (!videoLocalActive || !videoConfirmedRef.current) return;
    if (videoStatus && videoStatus.state !== 'live') {
      teardownVideoLocal();
      setVideoState({ pending: false, error: 'Broadcast ended unexpectedly on the server.' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoLocalActive, videoStatus]);

  // Release hardware (and tell the server to stop cleanly) if the whole
  // studio app unmounts — e.g. dashboard logout — while a browser-captured
  // broadcast is still running. Normal in-app navigation never unmounts
  // AppShell, so this only fires on a real session teardown.
  useEffect(() => () => {
    if (micLocalActive) stopAudio();
    if (videoLocalActive) stopVideo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    isDesktop,
    isLive: !!(audioStatus?.isLive || videoStatus?.state === 'live'),

    audioStatus, externalAudioStatus,
    micLocalActive, micState, startMic, stopAudio,
    externalAudioState, startExternalAudio, regenerateExternalAudioKey,
    getMicAnalyser: () => micAnalyserRef.current,

    videoStatus, videoSettings,
    videoLocalActive, videoState, startVideoBrowser, startVideoRtmp, stopVideo,
    regenerateVideoKey, saveVideoSettings,
    getVideoPreviewStream: () => videoStreamRef.current,
  };
}

export type LiveBroadcastEngine = ReturnType<typeof useLiveBroadcast>;
