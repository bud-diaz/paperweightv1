import {
  ArrowUpRight, BookOpen, ChevronLeft, ChevronRight, Heart, Link2, Music2, Pause,
  Play, Radio, Share2,
} from 'lucide-react';

import { IconButton, TrackRow, Waveform } from '@/components/primitives';
import type { ModalKey, Track } from '@/types';

export function PlayerView({ onPlay, playing, queue, onOpen, onNotify }: { onPlay: () => void; playing: boolean; queue: Track[]; onOpen: (modal: ModalKey) => void; onNotify: (message: string) => void }) {
  return (
    <div className="animate-enter player-workspace">
      <div className="mode-view-intro player-intro">
        <div><p className="font-mono-ui text-[10px] uppercase tracking-[.24em] text-primary">Play / Station</p><h1 className="font-display text-4xl sm:text-5xl font-semibold tracking-[-.06em] title-gradient">Luna Vale Radio.</h1><p className="text-muted-foreground mt-3">A private signal for your people, on whenever you are.</p></div>
        <div className="flex gap-2"><button type="button" data-testid="button-player-share" onClick={() => onOpen('share')} className="ghost-button rounded-xl px-4 py-2.5 text-sm flex items-center gap-2"><Share2 size={15} /> Share</button><button type="button" data-testid="button-player-support" onClick={() => onOpen('support')} className="lime-button rounded-xl px-4 py-2.5 text-sm font-semibold flex items-center gap-2"><Heart size={15} /> Support</button></div>
      </div>
      <div className="player-stage panel rounded-[2rem] overflow-hidden">
        <div className="player-stage-glow" />
        <div className="player-artwork" aria-label="Luna Vale album artwork"><div className="artwork-ring artwork-ring-one" /><div className="artwork-ring artwork-ring-two" /><div className="artwork-core"><Music2 size={38} /></div><span className="artwork-label">NIGHT<br />BLOOM</span></div>
        <div className="player-copy"><span className="font-mono-ui text-[10px] uppercase tracking-[.22em] text-primary">{playing ? 'Playing now' : 'Station paused'}</span><h2 className="font-display text-3xl sm:text-4xl font-semibold mt-3">Night Bloom</h2><p className="text-muted-foreground mt-2">Luna Vale · Afterimage</p><div className="player-wave"><Waveform /></div><div className="flex items-center justify-between font-mono-ui text-[10px] text-muted-foreground mt-3"><span>00:42</span><span>03:42</span></div><div className="player-controls"><IconButton label="Previous track" onClick={() => onNotify('Already at the first track in this run.')}><ChevronLeft size={17} /></IconButton><button type="button" data-testid="button-player-play" onClick={onPlay} className="player-play-button">{playing ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" />}</button><IconButton label="Next track" onClick={() => onNotify('Next track queued: Body Language.')}><ChevronRight size={17} /></IconButton></div></div>
      </div>
      <div className="player-lower-grid">
        <section className="panel rounded-2xl p-5 sm:p-6"><div className="flex items-center justify-between mb-4"><div><p className="font-mono-ui text-[10px] uppercase tracking-[.2em] text-muted-foreground">Up next</p><h2 className="font-display text-xl font-semibold mt-1">Your stash</h2></div><button type="button" data-testid="button-player-queue" onClick={() => onOpen('library')} className="text-xs text-primary flex items-center gap-1">{queue.length} tracks <ArrowUpRight size={13} /></button></div>{queue.slice(0, 3).map((track, index) => <TrackRow key={`${track.id}-${index}`} track={track} index={index} playing={false} onPlay={onPlay} />)}</section>
        <section className="panel rounded-2xl p-5 sm:p-6"><div className="flex items-center gap-3"><span className="h-9 w-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center"><Radio size={16} /></span><div><p className="font-mono-ui text-[10px] uppercase tracking-[.2em] text-primary">Private signal</p><h2 className="font-display text-xl font-semibold mt-1">Keep the room close.</h2></div></div><p className="text-sm text-muted-foreground mt-5 leading-relaxed">Share a listening link with the people who should hear it first, or open the studio to see how the signal is moving.</p><button type="button" data-testid="button-player-private-share" onClick={() => onOpen('share')} className="ghost-button rounded-xl px-3 py-2.5 text-xs mt-5 flex items-center gap-2"><Link2 size={14} /> Create private link</button></section>
      </div>
      <button type="button" data-testid="button-player-library" onClick={() => onOpen('library')} className="glass-dock"><BookOpen size={15} /><span>Open full library</span><ArrowUpRight size={13} className="ml-auto" /></button>
    </div>
  );
}
