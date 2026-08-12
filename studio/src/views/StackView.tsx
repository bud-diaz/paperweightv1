import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowUpRight, ChevronDown, Disc3, ListMusic, LockKeyhole, Pause, Play, Search,
} from 'lucide-react';

import { EmptyState } from '@/components/primitives';
import * as api from '@/lib/api';
import { formatDuration, swatchFor, type LibraryItem, type LibraryStructure } from '@/lib/library';
import { cn } from '@/lib/utils';
import { isPlayableTrack, type PlayerEngine } from '@/lib/hooks/usePlayerEngine';
import type { ModalKey } from '@/types';

type StackTrack = LibraryItem & { collection: string };

function TrackRowReal({ track, collection, active, playing, isPaid, onSelect }: { track: StackTrack; collection: string; active: boolean; playing: boolean; isPaid: boolean; onSelect: () => void }) {
  const locked = !isPlayableTrack({ ...track, visibility: track.visibility || 'public' }, isPaid);
  return (
    <div data-testid={`row-track-${track.id}`} className={cn('group flex items-center gap-3 py-3 border-b border-white/[.07] last:border-0', active && 'text-primary')}>
      <button type="button" aria-label={`Play ${track.title}`} data-testid={`button-play-track-${track.id}`} onClick={onSelect} className="relative h-9 w-9 shrink-0 rounded-md flex items-center justify-center overflow-hidden" style={{ background: `linear-gradient(135deg, ${swatchFor(track.id)}, rgba(255,255,255,.1))` }}>
        {active && playing ? <Pause size={14} fill="currentColor" className="text-[#1b1d2a]" /> : <Play size={14} fill="currentColor" className="text-[#1b1d2a]" />}
      </button>
      <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{track.title}</p><p className="truncate text-xs text-muted-foreground">{[track.artist, collection].filter(Boolean).join(' · ')}</p></div>
      {locked && <LockKeyhole size={13} className="text-muted-foreground shrink-0" />}
      <span className="font-mono-ui text-[11px] text-muted-foreground w-10 text-right">{formatDuration(track.duration)}</span>
    </div>
  );
}

export function StackView({ engine, onNotify }: { engine: PlayerEngine; onOpen: (modal: ModalKey) => void; onNotify: (message: string) => void }) {
  const [expanded, setExpanded] = useState<'library' | 'stash'>('library');
  const [search, setSearch] = useState('');
  const { data: structure, isLoading } = useQuery<LibraryStructure>({ queryKey: ['library', 'structure'], queryFn: () => api.library.structure() });

  const allTracks = useMemo(() => {
    const projects = structure?.projects || [];
    const standalone = structure?.standalone || [];
    return [
      ...projects.flatMap((project) => project.tracks.map((track) => ({ ...track, collection: project.name }))),
      ...standalone.map((track) => ({ ...track, collection: track.category || 'Standalone' })),
    ];
  }, [structure]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return allTracks;
    return allTracks.filter((track) => `${track.title} ${track.collection}`.toLowerCase().includes(q));
  }, [allTracks, search]);

  const projects = structure?.projects || [];

  return (
    <div className="animate-enter stack-workspace">
      <div className="mode-view-intro">
        <div>
          <p className="font-mono-ui text-[10px] uppercase tracking-[.24em] text-primary">Stack / Library</p>
          <h1 className="font-display text-4xl sm:text-5xl font-semibold tracking-[-.06em] title-gradient">Everything they’ve made.</h1>
          <p className="text-muted-foreground mt-3 max-w-lg">Releases, broadcasts, and sketches — browse the catalog, or head to Play to tune into the live station.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" data-testid="button-stack-search" onClick={() => document.getElementById('stack-search')?.focus()} className="ghost-button rounded-xl px-4 py-2.5 text-sm flex items-center gap-2"><Search size={15} /> Search</button>
        </div>
      </div>
      <div className="stack-layout">
        <section className="panel stack-panel rounded-3xl overflow-hidden">
          <button type="button" className="stack-card-head" onClick={() => setExpanded(expanded === 'library' ? 'stash' : 'library')} aria-expanded={expanded === 'library'}>
            <span className="stack-card-glyph"><Disc3 size={15} /></span>
            <span className="stack-card-title">LIBRARY <span className="stack-card-badge">{String(allTracks.length).padStart(2, '0')} PIECES</span></span>
            <span className="stack-card-peek">Your catalog</span>
            <ChevronDown size={15} className={cn('stack-card-chevron', expanded === 'library' && 'open')} />
          </button>
          {expanded === 'library' && <div className="stack-card-body"><div className="stack-card-content">
            <div className="stack-search-wrap"><Search size={14} /><input id="stack-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search the catalog…" aria-label="Search the catalog" /></div>
            {projects.length > 0 && <div className="stack-folder-grid">
              {projects.map((project) => <button type="button" key={project.id} className="stack-folder" onClick={() => onNotify(`${project.name}: ${project.tracks.length} tracks`)}>
                <span className="stack-folder-orb"><Disc3 size={18} /></span>
                <span className="stack-folder-copy"><strong>{project.name}</strong><small>{project.tracks.length} tracks</small></span>
                <ArrowUpRight size={14} />
              </button>)}
            </div>}
            <div className="stack-section-label">ALL WORKS</div>
            {isLoading ? <p className="text-sm text-muted-foreground py-6">Loading catalog…</p> : <div>{filtered.map((track) => <TrackRowReal key={track.id} track={track} collection={track.collection} active={engine.track?.id === track.id} playing={engine.playing} isPaid={engine.isPaid} onSelect={() => engine.selectTrack({ id: track.id, title: track.title, artist: track.artist, category: track.category, duration: track.duration, visibility: track.visibility || 'public', unlocked: track.unlocked, isExternal: track.isExternal })} />)}</div>}
            {!isLoading && !filtered.length && <EmptyState icon={Search} title="Nothing in that frequency" body="Try another title, or check back once something's been released." action="Clear search" onClick={() => setSearch('')} />}
          </div></div>}
        </section>
        <section className="panel stack-panel rounded-3xl overflow-hidden">
          <button type="button" className="stack-card-head" onClick={() => setExpanded(expanded === 'stash' ? 'library' : 'stash')} aria-expanded={expanded === 'stash'}>
            <span className="stack-card-glyph coral"><ListMusic size={15} /></span>
            <span className="stack-card-title">STASH</span>
            <span className="stack-card-peek">Offline saves</span>
            <ChevronDown size={15} className={cn('stack-card-chevron', expanded === 'stash' && 'open')} />
          </button>
          {expanded === 'stash' && <div className="stack-card-body"><div className="stack-card-content">
            <EmptyState icon={ListMusic} title="Offline saves are wired in a later pass" body="Saving tracks for offline listening is coming soon." action="Browse library" onClick={() => setExpanded('library')} />
          </div></div>}
        </section>
      </div>
      <div className="stack-footer-glass"><div className="flex items-center gap-3 min-w-0"><span className={cn('h-2 w-2 rounded-full shrink-0', engine.playing ? 'bg-primary animate-pulse' : 'bg-white/20')} /><span className="font-mono-ui text-[10px] uppercase tracking-[.18em] truncate">{engine.track ? `${engine.isPreview ? 'Preview' : 'Playing'}: ${engine.track.title}` : engine.playing ? 'Signal active' : 'Signal paused'}</span></div><button type="button" data-testid="button-stack-open-player" onClick={engine.track ? () => engine.goLive(true) : engine.toggle} className="text-xs text-primary flex items-center gap-1 shrink-0">{engine.track ? 'Back to live' : engine.playing ? 'Pause signal' : 'Play signal'} <Play size={12} fill="currentColor" /></button></div>
    </div>
  );
}
