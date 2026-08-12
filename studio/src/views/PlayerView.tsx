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

export function PlayerView({ engine, onOpen, onNotify }: { engine: PlayerEngine; onOpen: (modal: ModalKey) => void; onNotify: (message: string) => void }) {
  const { playing, reconnecting, toggle, stationName, nowPlaying, listenerCount, liveActive, stationQueue, recentlyPlayed } = engine;

  return (
    <div className="animate-enter player-workspace">
      <div className="mode-view-intro player-intro">
        <div><p className="font-mono-ui text-[10px] uppercase tracking-[.24em] text-primary">Play / Station</p><h1 className="font-display text-4xl sm:text-5xl font-semibold tracking-[-.06em] title-gradient">{stationName}.</h1><p className="text-muted-foreground mt-3">{listenerCount} {listenerCount === 1 ? 'listener' : 'listeners'} tuned in right now.</p></div>
        <div className="flex gap-2"><button type="button" data-testid="button-player-share" onClick={() => onOpen('share')} className="ghost-button rounded-xl px-4 py-2.5 text-sm flex items-center gap-2"><Share2 size={15} /> Share</button><button type="button" data-testid="button-player-support" onClick={() => onOpen('support')} className="lime-button rounded-xl px-4 py-2.5 text-sm font-semibold flex items-center gap-2"><Heart size={15} /> Support</button></div>
      </div>
      <div className="player-stage panel rounded-[2rem] overflow-hidden">
        <div className="player-stage-glow" />
        <div className="player-artwork" aria-label={`${stationName} artwork`}><div className="artwork-ring artwork-ring-one" /><div className="artwork-ring artwork-ring-two" /><div className="artwork-core"><Music2 size={38} /></div></div>
        <div className="player-copy">
          <span className="font-mono-ui text-[10px] uppercase tracking-[.22em] text-primary flex items-center gap-2">{liveActive && <span className="h-1.5 w-1.5 rounded-full bg-destructive animate-pulse" />}{reconnecting ? 'Reconnecting…' : liveActive ? 'Live now' : playing ? 'Playing now' : 'Station paused'}</span>
          <h2 className="font-display text-3xl sm:text-4xl font-semibold mt-3">{nowPlaying?.title || 'Nothing playing yet'}</h2>
          <p className="text-muted-foreground mt-2">{[nowPlaying?.artist, nowPlaying?.category].filter(Boolean).join(' · ') || stationName}</p>
          <div className="player-wave"><Waveform /></div>
          <div className="player-controls"><button type="button" data-testid="button-player-play" onClick={toggle} className="player-play-button">{playing ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" />}</button></div>
        </div>
      </div>
      <div className="player-lower-grid">
        <section className="panel rounded-2xl p-5 sm:p-6"><div className="flex items-center justify-between mb-4"><div><p className="font-mono-ui text-[10px] uppercase tracking-[.2em] text-muted-foreground">Rotation</p><h2 className="font-display text-xl font-semibold mt-1">Up next</h2></div></div>
          {stationQueue.length ? stationQueue.slice(0, 4).map((track) => <div key={track.id} className="flex items-center gap-3 py-2.5 border-b border-white/[.07] last:border-0"><span className="flex-1 min-w-0 text-sm truncate">{track.title}</span><span className="font-mono-ui text-[11px] text-muted-foreground">{formatDuration(track.duration)}</span></div>)
          : <p className="text-sm text-muted-foreground py-4">Nothing queued — the station is shuffling the full catalog.</p>}
        </section>
        <section className="panel rounded-2xl p-5 sm:p-6">
          {recentlyPlayed.length ? <><div className="flex items-center gap-3 mb-4"><span className="h-9 w-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center"><Radio size={16} /></span><div><p className="font-mono-ui text-[10px] uppercase tracking-[.2em] text-primary">Just played</p><h2 className="font-display text-xl font-semibold mt-1">Recently on air.</h2></div></div>{recentlyPlayed.slice(0, 3).map((track) => <div key={`${track.id}-${track.playedAt}`} className="flex items-center gap-3 py-2 text-sm"><span className="flex-1 min-w-0 truncate">{track.title}</span>{track.artist && <span className="text-xs text-muted-foreground truncate">{track.artist}</span>}</div>)}</> : <><div className="flex items-center gap-3"><span className="h-9 w-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center"><Radio size={16} /></span><div><p className="font-mono-ui text-[10px] uppercase tracking-[.2em] text-primary">Private signal</p><h2 className="font-display text-xl font-semibold mt-1">Keep the room close.</h2></div></div><p className="text-sm text-muted-foreground mt-5 leading-relaxed">Share a listening link with the people who should hear it first.</p><button type="button" data-testid="button-player-private-share" onClick={() => onOpen('share')} className="ghost-button rounded-xl px-3 py-2.5 text-xs mt-5 flex items-center gap-2"><Link2 size={14} /> Create private link</button></>}
        </section>
      </div>
    </div>
  );
}
