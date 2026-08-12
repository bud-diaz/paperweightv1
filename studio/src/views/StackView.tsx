import { useState } from 'react';
import {
  ArrowUpRight, ChevronDown, CloudUpload, Disc3, ListMusic, Play, Search,
} from 'lucide-react';

import { EmptyState, TrackRow } from '@/components/primitives';
import { collections, tracks } from '@/data/mockData';
import { cn } from '@/lib/utils';
import type { ModalKey, Track } from '@/types';

export function StackView({ onPlay, playing, queue, onOpen, onNotify }: { onPlay: () => void; playing: boolean; queue: Track[]; onOpen: (modal: ModalKey) => void; onNotify: (message: string) => void }) {
  const [expanded, setExpanded] = useState<'library' | 'stash'>('library');
  const [search, setSearch] = useState('');
  const filtered = tracks.filter((track) => `${track.title} ${track.collection} ${track.kind || ''}`.toLowerCase().includes(search.toLowerCase()));
  return (
    <div className="animate-enter stack-workspace">
      <div className="mode-view-intro">
        <div>
          <p className="font-mono-ui text-[10px] uppercase tracking-[.24em] text-primary">Stack / Library</p>
          <h1 className="font-display text-4xl sm:text-5xl font-semibold tracking-[-.06em] title-gradient">Everything you’ve made.</h1>
          <p className="text-muted-foreground mt-3 max-w-lg">A tactile home for releases, broadcasts, sketches, and the next piece waiting to be heard.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" data-testid="button-stack-search" onClick={() => document.getElementById('stack-search')?.focus()} className="ghost-button rounded-xl px-4 py-2.5 text-sm flex items-center gap-2"><Search size={15} /> Search</button>
          <button type="button" data-testid="button-stack-upload" onClick={() => onOpen('upload')} className="lime-button rounded-xl px-4 py-2.5 text-sm font-semibold flex items-center gap-2"><CloudUpload size={15} /> Add to stack</button>
        </div>
      </div>
      <div className="stack-layout">
        <section className="panel stack-panel rounded-3xl overflow-hidden">
          <button type="button" className="stack-card-head" onClick={() => setExpanded(expanded === 'library' ? 'stash' : 'library')} aria-expanded={expanded === 'library'}>
            <span className="stack-card-glyph"><Disc3 size={15} /></span>
            <span className="stack-card-title">LIBRARY <span className="stack-card-badge">05 PIECES</span></span>
            <span className="stack-card-peek">Your catalog</span>
            <ChevronDown size={15} className={cn('stack-card-chevron', expanded === 'library' && 'open')} />
          </button>
          {expanded === 'library' && <div className="stack-card-body"><div className="stack-card-content">
            <div className="stack-search-wrap"><Search size={14} /><input id="stack-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search your stack…" aria-label="Search your stack" /></div>
            <div className="stack-folder-grid">
              {collections.map((collection) => <button type="button" key={collection.id} className="stack-folder" onClick={() => onNotify(`${collection.title} opened in the library.`)}>
                <span className={cn('stack-folder-orb', collection.tone)}><Disc3 size={18} /></span>
                <span className="stack-folder-copy"><strong>{collection.title}</strong><small>{collection.count} · {collection.type}</small></span>
                <ArrowUpRight size={14} />
              </button>)}
            </div>
            <div className="stack-section-label">ALL WORKS</div>
            <div>{filtered.map((track, index) => <TrackRow key={track.id} track={track} index={index} playing={playing && track.id === 1} onPlay={onPlay} onAdd={() => onNotify(`${track.title} added to the queue.`)} />)}</div>
            {!filtered.length && <EmptyState icon={Search} title="Nothing in that frequency" body="Try another title or add something new." action="Clear search" onClick={() => setSearch('')} />}
          </div></div>}
        </section>
        <section className="panel stack-panel rounded-3xl overflow-hidden">
          <button type="button" className="stack-card-head" onClick={() => setExpanded(expanded === 'stash' ? 'library' : 'stash')} aria-expanded={expanded === 'stash'}>
            <span className="stack-card-glyph coral"><ListMusic size={15} /></span>
            <span className="stack-card-title">STASH <span className="stack-card-badge coral-text">{String(queue.length).padStart(2, '0')} QUEUED</span></span>
            <span className="stack-card-peek">{queue[0]?.title || 'Nothing queued'}</span>
            <ChevronDown size={15} className={cn('stack-card-chevron', expanded === 'stash' && 'open')} />
          </button>
          {expanded === 'stash' && <div className="stack-card-body"><div className="stack-card-content">
            {queue.length ? queue.map((track, index) => <TrackRow key={`${track.id}-${index}`} track={track} index={index} playing={false} onPlay={onPlay} onRemove={() => onNotify(`${track.title} removed from the queue.`)} />) : <EmptyState icon={ListMusic} title="Your stash is quiet" body="Add tracks from the library to build a personal run." action="Browse library" onClick={() => setExpanded('library')} />}
            <div className="flex items-center justify-between gap-3 pt-4 mt-2 border-t border-white/[.08]"><span className="text-xs text-muted-foreground">Your personal run</span><button type="button" data-testid="button-stack-clear" onClick={() => onNotify('Stash cleared.')} className="text-xs text-accent">Clear stash</button></div>
          </div></div>}
        </section>
      </div>
      <div className="stack-footer-glass"><div className="flex items-center gap-3"><span className={cn('h-2 w-2 rounded-full', playing ? 'bg-primary animate-pulse' : 'bg-white/20')} /><span className="font-mono-ui text-[10px] uppercase tracking-[.18em]">{playing ? 'Signal active' : 'Signal paused'}</span></div><button type="button" data-testid="button-stack-open-player" onClick={onPlay} className="text-xs text-primary flex items-center gap-1">{playing ? 'Pause signal' : 'Play signal'} <Play size={12} fill="currentColor" /></button></div>
    </div>
  );
}
