import { useEffect, useRef } from 'react';
import {
  Link2, Music2, Pause, Play, Radio, Share2, Heart,
} from 'lucide-react';

import { Waveform } from '@/components/primitives';
import type { PlayerEngine } from '@/lib/hooks/usePlayerEngine';
import type { ModalKey } from '@/types';

function formatDuration(seconds: number | null | undefined) {
  if (!seconds || !Number.isFinite(seconds)) return '';
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function PlayerView({ engine, onOpen, onPlayButtonVisibilityChange }: { engine: PlayerEngine; onOpen: (modal: ModalKey) => void; onNotify: (message: string) => void; onPlayButtonVisibilityChange?: (visible: boolean) => void }) {
  const { playing, reconnecting, toggle, stationName, nowPlaying, listenerCount, liveActive, liveVideoActive, stationQueue, recentlyPlayed, track, isPreview, odProgress, odElapsed, quota, goLive, isVideoActive, videoRef } = engine;
  const playButtonRef = useRef<HTMLButtonElement>(null);

  // Feeds the sticky transport (mounted outside this view, so it survives
  // tab switches) — it should only show once this button scrolls out of view.
  useEffect(() => {
    if (!onPlayButtonVisibilityChange) return;
    const el = playButtonRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => onPlayButtonVisibilityChange(entry.isIntersecting), { threshold: 0 });
    observer.observe(el);
    return () => observer.disconnect();
  }, [onPlayButtonVisibilityChange]);

  const artworkId = track?.id ?? nowPlaying?.id ?? null;
  const title = track ? track.title : (nowPlaying?.title || 'Nothing playing yet');
  const subtitle = track ? [track.artist, track.category].filter(Boolean).join(' · ') : ([nowPlaying?.artist, nowPlaying?.category].filter(Boolean).join(' · ') || stationName);
  const quotaText = !track && quota && quota.limit != null && !quota.unlimited
    ? `${Math.max(0, quota.remaining ?? 0)} on-demand ${quota.remaining === 1 ? 'play' : 'plays'} left this hour`
    : null;
  const statusLabel = track
    ? (isPreview ? (isVideoActive ? 'Video preview' : 'Preview') : (isVideoActive ? 'On-demand video' : 'On demand'))
    : reconnecting ? 'Reconnecting…'
      : liveVideoActive ? 'Live video'
        : liveActive ? 'Live now'
          : playing ? (isVideoActive ? 'Watching now' : 'Playing now')
            : 'Station paused';

  return (
    <div className="animate-enter player-workspace">
      <div className="mode-view-intro player-intro">
        <div><p className="font-mono-ui text-[10px] uppercase tracking-[.24em] text-primary">Play / Station</p><h1 className="font-display text-4xl sm:text-5xl font-semibold tracking-[-.06em]">{stationName}.</h1><p className="text-muted-foreground mt-3">{listenerCount} {listenerCount === 1 ? 'listener' : 'listeners'} tuned in right now.</p></div>
        <div className="flex gap-2"><button type="button" data-testid="button-player-share" onClick={() => onOpen('share')} className="ghost-button rounded-xl px-4 py-2.5 text-sm flex items-center gap-2"><Share2 size={15} /> Share</button><button type="button" data-testid="button-player-support" onClick={() => onOpen('support')} className="lime-button rounded-xl px-4 py-2.5 text-sm font-semibold flex items-center gap-2"><Heart size={15} /> Support</button></div>
      </div>
      <div className="player-stage panel rounded-[2rem] overflow-hidden">
        <div className="player-stage-glow" />
        {isVideoActive ? (
          <div className="player-video-shell" data-testid="player-video-shell">
            <video ref={videoRef} data-testid="player-video" className="player-video" playsInline controls aria-label={title} />
            {!playing && <div className="player-video-idle"><Play size={24} fill="currentColor" /></div>}
          </div>
        ) : (
          <div className="player-artwork" aria-label={`${stationName} artwork`}>
            {artworkId != null ? (
              <img src={`/api/library/${artworkId}/artwork`} alt="" className="player-artwork-img" />
            ) : (
              <>
                <div className="artwork-ring artwork-ring-one" />
                <div className="artwork-ring artwork-ring-two" />
                <div className="artwork-core"><Music2 size={38} /></div>
              </>
            )}
          </div>
        )}
        <div className="player-copy">
          <span className="font-mono-ui text-[10px] uppercase tracking-[.22em] text-primary flex items-center gap-2">
            {!track && (liveActive || liveVideoActive) && <span className="h-1.5 w-1.5 rounded-full bg-destructive animate-pulse" />}
            {statusLabel}
          </span>
          <h2 className="font-display text-3xl sm:text-4xl font-semibold mt-3">{title}</h2>
          <p className="text-muted-foreground mt-2">{subtitle}</p>
          {track ? <>
            <div className="h-1.5 rounded-full bg-white/10 mt-8 overflow-hidden"><div className="h-full bg-primary rounded-full" style={{ width: `${Math.round(odProgress * 100)}%` }} /></div>
            <div className="flex items-center justify-between font-mono-ui text-[10px] text-muted-foreground mt-2"><span>{formatDuration(odElapsed)}</span><span>{isPreview ? '0:30 preview' : formatDuration(track.duration)}</span></div>
          </> : isVideoActive ? <p className="text-sm text-muted-foreground mt-8 leading-relaxed">Video is routed through the same creator-owned station signal. Use the player controls for fullscreen, seek, and device volume.</p> : <div className="player-wave"><Waveform engine={engine} /></div>}
          <div className="player-controls">
            <button type="button" ref={playButtonRef} data-testid="button-player-play" onClick={toggle} className="player-play-button">{playing ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" />}</button>
            {track && <button type="button" data-testid="button-player-back-live" onClick={() => goLive(true)} className="ghost-button rounded-lg px-3 py-2 text-xs flex items-center gap-2 ml-3"><Radio size={13} /> Back to live</button>}
          </div>
          {quotaText && <p className="text-xs text-muted-foreground mt-4">{quotaText}</p>}
        </div>
      </div>
      <div className="player-lower-grid">
        <section className="panel rounded-2xl p-5 sm:p-6"><div className="flex items-center justify-between mb-4"><div><p className="font-mono-ui text-[10px] uppercase tracking-[.2em] text-muted-foreground">Rotation</p><h2 className="font-display text-xl font-semibold mt-1">Up next</h2></div></div>
          {stationQueue.length ? stationQueue.slice(0, 4).map((queued) => <div key={queued.id} className="flex items-center gap-3 py-2.5 border-b border-white/[.07] last:border-0"><span className="flex-1 min-w-0 text-sm truncate">{queued.title}</span>{queued.isVideo && <span className="font-mono-ui text-[10px] text-primary">VIDEO</span>}<span className="font-mono-ui text-[11px] text-muted-foreground">{formatDuration(queued.duration)}</span></div>)
          : <p className="text-sm text-muted-foreground py-4">Nothing queued — the station is shuffling the full catalog.</p>}
        </section>
        <section className="panel rounded-2xl p-5 sm:p-6">
          {recentlyPlayed.length ? <><div className="flex items-center gap-3 mb-4"><span className="h-9 w-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center"><Radio size={16} /></span><div><p className="font-mono-ui text-[10px] uppercase tracking-[.2em] text-primary">Just played</p><h2 className="font-display text-xl font-semibold mt-1">Recently on air.</h2></div></div>{recentlyPlayed.slice(0, 3).map((played) => <div key={`${played.id}-${played.playedAt}`} className="flex items-center gap-3 py-2 text-sm"><span className="flex-1 min-w-0 truncate">{played.title}</span>{played.isVideo && <span className="font-mono-ui text-[10px] text-primary">VIDEO</span>}{played.artist && <span className="text-xs text-muted-foreground truncate">{played.artist}</span>}</div>)}</> : <><div className="flex items-center gap-3"><span className="h-9 w-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center"><Radio size={16} /></span><div><p className="font-mono-ui text-[10px] uppercase tracking-[.2em] text-primary">Private signal</p><h2 className="font-display text-xl font-semibold mt-1">Keep the room close.</h2></div></div><p className="text-sm text-muted-foreground mt-5 leading-relaxed">Share a listening link with the people who should hear it first.</p><button type="button" data-testid="button-player-private-share" onClick={() => onOpen('share')} className="ghost-button rounded-xl px-3 py-2.5 text-xs mt-5 flex items-center gap-2"><Link2 size={14} /> Create private link</button></>}
        </section>
      </div>
    </div>
  );
}
