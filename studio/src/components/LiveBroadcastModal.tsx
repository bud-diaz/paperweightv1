import { useEffect, useRef, useState } from 'react';
import { Copy, Mic2, RefreshCw, Square, Video } from 'lucide-react';

import { Modal } from '@/components/primitives';
import type { LiveBroadcastEngine } from '@/lib/hooks/useLiveBroadcast';
import { cn } from '@/lib/utils';

function useElapsedLabel(startedAt: string | null | undefined, active: boolean) {
  const [label, setLabel] = useState('0:00');
  useEffect(() => {
    if (!active || !startedAt) { setLabel('0:00'); return; }
    const startMs = new Date(startedAt).getTime();
    function tick() {
      const totalSeconds = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      setLabel(`${minutes}:${String(seconds).padStart(2, '0')}`);
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt, active]);
  return label;
}

async function copyText(text: string, notify: (message: string) => void) {
  if (!text) return;
  try { await navigator.clipboard.writeText(text); notify('Copied.'); } catch { /* clipboard unavailable */ }
}

function RtmpFields({ url, streamKey, onRegenerate, onNotify }: { url: string; streamKey: string; onRegenerate: () => void; onNotify: (message: string) => void }) {
  return <div className="space-y-3">
    <div className="panel-subtle rounded-xl p-3">
      <p className="text-[10px] uppercase tracking-[.15em] text-muted-foreground">Server</p>
      <div className="flex items-center gap-2 mt-1"><p className="font-mono-ui text-xs flex-1 truncate">{url}</p><button type="button" aria-label="Copy server URL" onClick={() => copyText(url, onNotify)} className="text-muted-foreground hover:text-primary"><Copy size={13} /></button></div>
    </div>
    <div className="panel-subtle rounded-xl p-3">
      <p className="text-[10px] uppercase tracking-[.15em] text-muted-foreground">Stream key</p>
      <div className="flex items-center gap-2 mt-1"><p className="font-mono-ui text-xs flex-1 truncate">{streamKey}</p><button type="button" aria-label="Copy stream key" onClick={() => copyText(streamKey, onNotify)} className="text-muted-foreground hover:text-primary"><Copy size={13} /></button></div>
    </div>
    <button type="button" data-testid="button-regenerate-stream-key" onClick={onRegenerate} className="ghost-button rounded-lg px-3 py-2 text-xs flex items-center gap-2"><RefreshCw size={12} /> Regenerate key</button>
  </div>;
}

function AudioPanel({ engine, onNotify }: { engine: LiveBroadcastEngine; onNotify: (message: string) => void }) {
  const [source, setSource] = useState<'mic' | 'rtmp'>('mic');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onAirAudioRef = useRef<HTMLAudioElement>(null);

  const isLive = !!engine.audioStatus?.isLive;
  const isPending = !!engine.audioStatus?.rtmpPending;
  const onAirSource = engine.audioStatus?.source;
  const showOnAir = isLive;
  const showPending = isPending && !isLive;
  const showIdle = !isLive && !isPending;
  const elapsed = useElapsedLabel(engine.audioStatus?.startedAt, isLive);

  useEffect(() => {
    if (isLive && onAirSource) setSource(onAirSource);
  }, [isLive, onAirSource]);

  // Waveform: taps the local mic capture when this tab is driving it, or falls
  // back to an on-air HLS tap (RTMP source, or a reload that lost the local
  // getUserMedia stream) — mirrors client/js/dashboard/live.js's dual-tap design.
  useEffect(() => {
    if (!showOnAir) return;
    let raf = 0;
    let tapCtx: AudioContext | null = null;
    let hls: ReturnType<NonNullable<typeof window.Hls>['prototype']['constructor']> | null = null;
    let analyser: AnalyserNode | null = engine.micLocalActive ? engine.getMicAnalyser() : null;

    function draw() {
      raf = requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      if (!canvas || !analyser) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const data = new Uint8Array(analyser.fftSize);
      analyser.getByteTimeDomainData(data);
      const w = canvas.width, h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#c84b20'; // oxide — canvas can't read CSS custom properties, keep in sync with --pw-oxide
      ctx.beginPath();
      const step = w / data.length;
      for (let i = 0; i < data.length; i++) {
        const y = h / 2 + (data[i] / 128 - 1) * (h / 2) * 0.9;
        const x = i * step;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    if (analyser) {
      draw();
    } else {
      const audioEl = onAirAudioRef.current;
      if (audioEl && window.Hls) {
        tapCtx = new AudioContext();
        const mediaSource = tapCtx.createMediaElementSource(audioEl);
        analyser = tapCtx.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.75;
        mediaSource.connect(analyser);
        if (window.Hls.isSupported()) {
          hls = new window.Hls({ lowLatencyMode: false });
          hls.loadSource('/hls/live/index.m3u8');
          hls.attachMedia(audioEl);
        } else if (audioEl.canPlayType('application/vnd.apple.mpegurl')) {
          audioEl.src = '/hls/live/index.m3u8';
        }
        audioEl.muted = true;
        audioEl.play().catch(() => undefined);
        draw();
      }
    }

    return () => {
      cancelAnimationFrame(raf);
      if (hls) { try { hls.destroy(); } catch { /* already destroyed */ } }
      if (tapCtx) tapCtx.close().catch(() => undefined);
    };
  }, [showOnAir, engine.micLocalActive, engine]);

  if (showOnAir) {
    return <div className="space-y-5">
      <audio ref={onAirAudioRef} hidden />
      <div className="panel-subtle rounded-xl p-4 flex gap-3 items-center">
        <span className="h-2.5 w-2.5 rounded-full bg-destructive animate-pulse shrink-0" />
        <div><p className="text-sm font-medium">On air — {onAirSource === 'rtmp' ? 'external encoder' : 'mic'}</p><p className="text-xs text-muted-foreground mt-1 font-mono-ui">{elapsed}</p></div>
      </div>
      <canvas ref={canvasRef} width={480} height={80} className="w-full h-20 rounded-xl bg-black/30" />
      <button type="button" data-testid="button-end-audio-broadcast" onClick={() => engine.stopAudio()} className="w-full rounded-lg py-2.5 text-sm font-semibold bg-destructive text-white flex items-center justify-center gap-2"><Square size={14} fill="currentColor" /> End broadcast</button>
    </div>;
  }

  if (showPending) {
    return <div className="space-y-5">
      <div className="panel-subtle rounded-xl p-4 flex gap-3 items-start">
        <span className="h-2.5 w-2.5 rounded-full bg-primary animate-pulse mt-1 shrink-0" />
        <div><p className="text-sm font-medium">Waiting for OBS to connect…</p><p className="text-xs text-muted-foreground mt-1">Point OBS at the server and stream key below.</p></div>
      </div>
      {engine.externalAudioStatus?.rtmp && <RtmpFields url={engine.externalAudioStatus.rtmp.url} streamKey={engine.externalAudioStatus.rtmp.streamKey} onRegenerate={engine.regenerateExternalAudioKey} onNotify={onNotify} />}
      <button type="button" data-testid="button-cancel-audio-broadcast" onClick={() => engine.stopAudio()} className="ghost-button w-full rounded-lg py-2.5 text-sm">Cancel</button>
    </div>;
  }

  return <div className="space-y-5">
    {engine.isDesktop && <div className="grid grid-cols-2 gap-3">
      <button type="button" data-testid="button-audio-source-mic" onClick={() => setSource('mic')} className={cn('panel-subtle rounded-xl p-4 text-left', source === 'mic' && 'ring-1 ring-primary')}><Mic2 className="text-primary" size={18} /><p className="text-sm mt-3">Mic</p><p className="text-[11px] text-muted-foreground mt-1">Broadcast from this browser</p></button>
      <button type="button" data-testid="button-audio-source-rtmp" onClick={() => setSource('rtmp')} className={cn('panel-subtle rounded-xl p-4 text-left', source === 'rtmp' && 'ring-1 ring-primary')}><Video className="text-foreground" size={18} /><p className="text-sm mt-3">External encoder</p><p className="text-[11px] text-muted-foreground mt-1">OBS Studio (audio only)</p></button>
    </div>}
    {source === 'mic' ? <>
      {engine.micState.error && <p className="text-xs text-destructive">{engine.micState.error}</p>}
      <button type="button" data-testid="button-start-mic-broadcast" onClick={() => engine.startMic()} disabled={engine.micState.pending} className="w-full lime-button rounded-lg py-2.5 text-sm font-semibold disabled:opacity-50">{engine.micState.pending ? 'Requesting microphone…' : 'Go live with mic'}</button>
    </> : <>
      {engine.externalAudioState.error && <p className="text-xs text-destructive">{engine.externalAudioState.error}</p>}
      {engine.externalAudioStatus?.rtmp && <RtmpFields url={engine.externalAudioStatus.rtmp.url} streamKey={engine.externalAudioStatus.rtmp.streamKey} onRegenerate={engine.regenerateExternalAudioKey} onNotify={onNotify} />}
      <button type="button" data-testid="button-start-external-broadcast" onClick={() => engine.startExternalAudio()} disabled={engine.externalAudioState.pending} className="w-full lime-button rounded-lg py-2.5 text-sm font-semibold disabled:opacity-50">{engine.externalAudioState.pending ? 'Starting…' : 'Start listening for OBS'}</button>
    </>}
  </div>;
}

function VideoPanel({ engine, onNotify }: { engine: LiveBroadcastEngine; onNotify: (message: string) => void }) {
  const [source, setSource] = useState<'browser' | 'rtmp'>('browser');
  const localPreviewRef = useRef<HTMLVideoElement>(null);
  const onAirVideoRef = useRef<HTMLVideoElement>(null);

  const isLive = engine.videoStatus?.state === 'live';
  const isPending = engine.videoStatus?.state === 'pending';
  const onAirSource = engine.videoStatus?.source;
  const showOnAir = isLive;
  const showPending = isPending;
  const showIdle = !isLive && !isPending;
  const elapsed = useElapsedLabel(engine.videoStatus?.startedAt, isLive);

  useEffect(() => {
    if (isLive && onAirSource) setSource(onAirSource);
  }, [isLive, onAirSource]);

  useEffect(() => {
    const el = localPreviewRef.current;
    if (!el) return;
    el.srcObject = engine.videoLocalActive ? engine.getVideoPreviewStream() : null;
  }, [engine, engine.videoLocalActive]);

  useEffect(() => {
    if (!showOnAir || engine.videoLocalActive) return;
    const el = onAirVideoRef.current;
    if (!el || !window.Hls) return;
    let hls: ReturnType<NonNullable<typeof window.Hls>['prototype']['constructor']> | null = null;
    if (window.Hls.isSupported()) {
      hls = new window.Hls({ lowLatencyMode: false });
      hls.loadSource('/hls/live-video/index.m3u8');
      hls.attachMedia(el);
    } else if (el.canPlayType('application/vnd.apple.mpegurl')) {
      el.src = '/hls/live-video/index.m3u8';
    }
    return () => { if (hls) { try { hls.destroy(); } catch { /* already destroyed */ } } };
  }, [showOnAir, engine.videoLocalActive]);

  if (showOnAir) {
    return <div className="space-y-5">
      <div className="panel-subtle rounded-xl p-4 flex gap-3 items-center">
        <span className="h-2.5 w-2.5 rounded-full bg-destructive animate-pulse shrink-0" />
        <div><p className="text-sm font-medium">On air — {onAirSource === 'rtmp' ? 'external encoder' : 'camera'}</p><p className="text-xs text-muted-foreground mt-1 font-mono-ui">{elapsed}</p></div>
      </div>
      <video ref={engine.videoLocalActive ? localPreviewRef : onAirVideoRef} autoPlay muted playsInline className="w-full aspect-video rounded-xl bg-black object-cover" />
      <button type="button" data-testid="button-end-video-broadcast" onClick={() => engine.stopVideo()} className="w-full rounded-lg py-2.5 text-sm font-semibold bg-destructive text-white flex items-center justify-center gap-2"><Square size={14} fill="currentColor" /> End broadcast</button>
    </div>;
  }

  if (showPending) {
    return <div className="space-y-5">
      <div className="panel-subtle rounded-xl p-4 flex gap-3 items-start">
        <span className="h-2.5 w-2.5 rounded-full bg-primary animate-pulse mt-1 shrink-0" />
        <div><p className="text-sm font-medium">Waiting for OBS to connect…</p><p className="text-xs text-muted-foreground mt-1">Point OBS at the server and stream key below.</p></div>
      </div>
      {engine.videoStatus?.rtmp && <RtmpFields url={engine.videoStatus.rtmp.url} streamKey={engine.videoStatus.rtmp.streamKey} onRegenerate={engine.regenerateVideoKey} onNotify={onNotify} />}
      <button type="button" data-testid="button-cancel-video-broadcast" onClick={() => engine.stopVideo()} className="ghost-button w-full rounded-lg py-2.5 text-sm">Cancel</button>
    </div>;
  }

  return <div className="space-y-5">
    {engine.isDesktop && <div className="grid grid-cols-2 gap-3">
      <button type="button" data-testid="button-video-source-browser" onClick={() => setSource('browser')} className={cn('panel-subtle rounded-xl p-4 text-left', source === 'browser' && 'ring-1 ring-primary')}><Video className="text-primary" size={18} /><p className="text-sm mt-3">Camera</p><p className="text-[11px] text-muted-foreground mt-1">Broadcast from this browser</p></button>
      <button type="button" data-testid="button-video-source-rtmp" onClick={() => setSource('rtmp')} className={cn('panel-subtle rounded-xl p-4 text-left', source === 'rtmp' && 'ring-1 ring-primary')}><Video className="text-foreground" size={18} /><p className="text-sm mt-3">External encoder</p><p className="text-[11px] text-muted-foreground mt-1">OBS Studio</p></button>
    </div>}
    {source === 'browser' ? <>
      {engine.videoState.error && <p className="text-xs text-destructive">{engine.videoState.error}</p>}
      {engine.videoLocalActive && <video ref={localPreviewRef} autoPlay muted playsInline className="w-full aspect-video rounded-xl bg-black object-cover" />}
      <button type="button" data-testid="button-start-video-broadcast" onClick={() => engine.startVideoBrowser()} disabled={engine.videoState.pending} className="w-full lime-button rounded-lg py-2.5 text-sm font-semibold disabled:opacity-50">{engine.videoState.pending ? 'Requesting camera…' : 'Go live with camera'}</button>
    </> : <>
      {engine.videoState.error && <p className="text-xs text-destructive">{engine.videoState.error}</p>}
      {engine.videoStatus?.rtmp && <RtmpFields url={engine.videoStatus.rtmp.url} streamKey={engine.videoStatus.rtmp.streamKey} onRegenerate={engine.regenerateVideoKey} onNotify={onNotify} />}
      <button type="button" data-testid="button-start-video-rtmp" onClick={() => engine.startVideoRtmp()} disabled={engine.videoState.pending} className="w-full lime-button rounded-lg py-2.5 text-sm font-semibold disabled:opacity-50">{engine.videoState.pending ? 'Starting…' : 'Start listening for OBS'}</button>
    </>}
    <label className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t border-white/[.08]">Minimum tier to watch
      <select data-testid="select-live-video-min-tier" value={engine.videoSettings?.minTier || 'subscriber'} onChange={(event) => engine.saveVideoSettings({ minTier: event.target.value as 'subscriber' | 'pro' | 'all_access' })} className="input-studio rounded-lg px-2 py-1.5 ml-2">
        <option value="subscriber">Subscriber</option>
        <option value="pro">Pro</option>
        <option value="all_access">All-access</option>
      </select>
    </label>
  </div>;
}

export function LiveBroadcastModal({ engine, onClose, onNotify }: { engine: LiveBroadcastEngine; onClose: () => void; onNotify: (message: string) => void }) {
  const [tab, setTab] = useState<'audio' | 'video'>(engine.videoStatus?.state === 'live' ? 'video' : 'audio');
  const anyOnAir = !!engine.audioStatus?.isLive || engine.videoStatus?.state === 'live';

  return <Modal title={anyOnAir ? 'The room is open.' : 'Set the room.'} eyebrow="Signal / Broadcast" onClose={onClose} width="max-w-lg">
    <div className="grid grid-cols-2 gap-2 mb-6 panel-subtle rounded-xl p-1">
      <button type="button" data-testid="button-live-tab-audio" onClick={() => setTab('audio')} className={cn('rounded-lg py-2 text-xs font-semibold flex items-center justify-center gap-2', tab === 'audio' ? 'bg-primary text-black' : 'text-muted-foreground')}><Mic2 size={13} /> Audio</button>
      <button type="button" data-testid="button-live-tab-video" onClick={() => setTab('video')} className={cn('rounded-lg py-2 text-xs font-semibold flex items-center justify-center gap-2', tab === 'video' ? 'bg-primary text-black' : 'text-muted-foreground')}><Video size={13} /> Video</button>
    </div>
    {tab === 'audio' ? <AudioPanel engine={engine} onNotify={onNotify} /> : <VideoPanel engine={engine} onNotify={onNotify} />}
  </Modal>;
}
