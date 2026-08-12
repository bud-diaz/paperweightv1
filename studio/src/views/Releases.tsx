import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  CloudUpload, Disc3, Globe2, ListMusic, Music2, Plus, RefreshCw,
} from 'lucide-react';

import { ActionCard, EmptyState, TrackRow, ViewHeader } from '@/components/primitives';
import * as api from '@/lib/api';
import { toDisplayTrack, type LibraryStructure } from '@/lib/library';
import { cn } from '@/lib/utils';
import type { ModalKey } from '@/types';

const STANDALONE_KEY = -1;

export function Releases({ onOpen, onNotify, playing, onPlay }: { onOpen: (modal: ModalKey) => void; onNotify: (message: string) => void; playing: boolean; onPlay: () => void }) {
  const { data: structure, isLoading } = useQuery<LibraryStructure>({ queryKey: ['library', 'structure'], queryFn: () => api.library.structure() });
  const [selected, setSelected] = useState<number | null>(null);

  const projects = structure?.projects || [];
  const standalone = structure?.standalone || [];
  const hasAnything = projects.length > 0 || standalone.length > 0;

  useEffect(() => {
    if (selected !== null) return;
    if (projects.length) setSelected(projects[0].id);
    else if (standalone.length) setSelected(STANDALONE_KEY);
  }, [projects, standalone, selected]);

  const selectedProject = projects.find((project) => project.id === selected);
  const collectionTracks = selected === STANDALONE_KEY
    ? standalone.map((track) => toDisplayTrack(track, track.category || 'Standalone'))
    : (selectedProject?.tracks || []).map((track) => toDisplayTrack(track, selectedProject!.name));

  return <div className="animate-enter"><ViewHeader eyebrow="Catalog / Releases" title="Your body of work." description="Shape the way people enter your world. Releases, broadcasts, and the fragments between." action={<button type="button" data-testid="button-create-collection" onClick={() => onNotify('Collection creation is wired in a later pass.')} className="lime-button rounded-xl px-4 py-2.5 text-sm font-semibold flex items-center gap-2"><Plus size={16} /> New collection</button>} />

    {isLoading ? <p className="text-sm text-muted-foreground py-6">Loading your catalog…</p> : !hasAnything ? (
      <EmptyState icon={Music2} title="Nothing in the vault yet" body="Upload a track to start your first release." action="Upload" onClick={() => onOpen('upload')} />
    ) : <>
      <div className="grid md:grid-cols-3 gap-3 mb-6">
        {projects.map((project) => (
          <button type="button" key={project.id} data-testid={`card-collection-${project.id}`} onClick={() => setSelected(project.id)} className={cn('text-left rounded-2xl p-5 min-h-44 relative overflow-hidden panel transition-all', selected === project.id && 'ring-1 ring-primary bg-primary/[.06]')}>
            <Disc3 className="relative text-muted-foreground mb-8" size={19} />
            <p className="font-display text-xl font-semibold relative">{project.name}</p>
            <div className="flex items-center justify-between mt-2 relative"><span className="text-xs text-muted-foreground">{project.description || 'Collection'}</span><span className="font-mono-ui text-[10px] text-primary">{project.tracks.length} tracks</span></div>
          </button>
        ))}
        {standalone.length > 0 && (
          <button type="button" data-testid="card-collection-standalone" onClick={() => setSelected(STANDALONE_KEY)} className={cn('text-left rounded-2xl p-5 min-h-44 relative overflow-hidden panel transition-all', selected === STANDALONE_KEY && 'ring-1 ring-primary bg-primary/[.06]')}>
            <ListMusic className="relative text-muted-foreground mb-8" size={19} />
            <p className="font-display text-xl font-semibold relative">Standalone</p>
            <div className="flex items-center justify-between mt-2 relative"><span className="text-xs text-muted-foreground">Not in a collection</span><span className="font-mono-ui text-[10px] text-primary">{standalone.length} tracks</span></div>
          </button>
        )}
      </div>
      <section className="panel rounded-2xl p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-white/[.08]">
          <div>
            <p className="font-mono-ui text-[10px] uppercase tracking-[.2em] text-muted-foreground">{selected === STANDALONE_KEY ? 'Not in a collection' : 'Collection'}</p>
            <h2 className="font-display text-2xl font-semibold mt-1">{selected === STANDALONE_KEY ? 'Standalone' : selectedProject?.name}</h2>
          </div>
          <button type="button" data-testid="button-add-track" onClick={() => onOpen('library')} className="ghost-button rounded-lg px-3 py-2 text-xs flex items-center gap-2"><Plus size={14} /> Add track</button>
        </div>
        <div className="mt-2">
          {collectionTracks.length ? collectionTracks.map((track, i) => <TrackRow key={track.id} track={track} index={i} playing={playing && i === 0} onPlay={onPlay} />) : <EmptyState icon={Music2} title="No tracks here yet" body="Bring in a work from your library or upload something new." action="Add a track" onClick={() => onOpen('library')} />}
        </div>
        {selected !== STANDALONE_KEY && <div className="mt-5 pt-4 border-t border-white/[.08] flex items-center gap-3 text-xs text-muted-foreground"><Globe2 size={14} className="text-primary" /> Track order and pricing management are wired in a later pass</div>}
      </section>
    </>}

    <div className="grid md:grid-cols-3 gap-3 mt-6">
      <ActionCard icon={CloudUpload} title="Upload a new cut" body="Audio, video, or a private sketch." onClick={() => onOpen('upload')} />
      <ActionCard icon={RefreshCw} title="Import from elsewhere" body="Bring in SoundCloud or Bandcamp links." onClick={() => onNotify('Import link copied — paste it into the library when ready.')} />
      <ActionCard icon={ListMusic} title="Build a smart playlist" body="Let your catalog tell a story." onClick={() => onNotify('Smart playlist builder is wired in a later pass.')} />
    </div>
  </div>;
}
