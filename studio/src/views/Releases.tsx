import { useState } from 'react';
import {
  CloudUpload, Disc3, Globe2, ListMusic, Music2, Pencil, Plus, RefreshCw,
} from 'lucide-react';

import { ActionCard, EmptyState, TrackRow, ViewHeader } from '@/components/primitives';
import { collections, tracks } from '@/data/mockData';
import { cn } from '@/lib/utils';
import type { ModalKey } from '@/types';

export function Releases({ onOpen, onNotify, playing, onPlay }: { onOpen: (modal: ModalKey) => void; onNotify: (message: string) => void; playing: boolean; onPlay: () => void }) {
  const [selected, setSelected] = useState(1);
  const [order, setOrder] = useState<number[]>(tracks.map((track) => track.id));
  const collectionTracks = tracks.filter((track) => selected === 1 ? track.collection === 'Afterimage' : selected === 2 ? track.collection === 'Nocturne FM' : track.collection === 'Sketchbook').sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  const moveTrack = (index: number, direction: -1 | 1) => {
    const next = [...order];
    const target = index + direction;
    if (target < 0 || target >= collectionTracks.length) return;
    const currentId = collectionTracks[index].id;
    const targetId = collectionTracks[target].id;
    const currentOrderIndex = next.indexOf(currentId);
    const targetOrderIndex = next.indexOf(targetId);
    [next[currentOrderIndex], next[targetOrderIndex]] = [next[targetOrderIndex], next[currentOrderIndex]];
    setOrder(next);
    onNotify('Track order updated.');
  };
  return <div className="animate-enter"><ViewHeader eyebrow="Catalog / Releases" title="Your body of work." description="Shape the way people enter your world. Releases, broadcasts, and the fragments between." action={<button type="button" data-testid="button-create-collection" onClick={() => onOpen('collection')} className="lime-button rounded-xl px-4 py-2.5 text-sm font-semibold flex items-center gap-2"><Plus size={16} /> New collection</button>} /><div className="grid md:grid-cols-3 gap-3 mb-6">{collections.map((collection) => <button type="button" key={collection.id} data-testid={`card-collection-${collection.id}`} onClick={() => setSelected(collection.id)} className={cn('text-left rounded-2xl p-5 min-h-44 relative overflow-hidden panel transition-all', selected === collection.id && 'ring-1 ring-primary bg-primary/[.06]')}><div className={cn('absolute -right-7 -top-10 h-32 w-32 rounded-full blur-2xl opacity-40', collection.tone === 'lime' ? 'bg-primary' : collection.tone === 'coral' ? 'bg-accent' : 'bg-[#8193ff]')} /><Disc3 className="relative text-muted-foreground mb-8" size={19} /><p className="font-display text-xl font-semibold relative">{collection.title}</p><div className="flex items-center justify-between mt-2 relative"><span className="text-xs text-muted-foreground">{collection.type}</span><span className="font-mono-ui text-[10px] text-primary">{collection.count}</span></div></button>)}</div><section className="panel rounded-2xl p-5 sm:p-6"><div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-white/[.08]"><div><p className="font-mono-ui text-[10px] uppercase tracking-[.2em] text-muted-foreground">{collections.find((collection) => collection.id === selected)?.type}</p><h2 className="font-display text-2xl font-semibold mt-1">{collections.find((collection) => collection.id === selected)?.title}</h2></div><div className="flex gap-2"><button type="button" data-testid="button-add-track" onClick={() => onOpen('library')} className="ghost-button rounded-lg px-3 py-2 text-xs flex items-center gap-2"><Plus size={14} /> Add track</button><button type="button" aria-label="Edit collection" data-testid="button-edit-collection" onClick={() => onOpen('collection')} className="h-9 w-9 rounded-lg inline-flex items-center justify-center ghost-button"><Pencil size={14} /></button></div></div><div className="mt-2">{collectionTracks.length ? collectionTracks.map((track, i) => <TrackRow key={track.id} track={track} index={i} playing={playing && track.id === 1} onPlay={onPlay} onMoveUp={i > 0 ? () => moveTrack(i, -1) : undefined} onMoveDown={i < collectionTracks.length - 1 ? () => moveTrack(i, 1) : undefined} />) : <EmptyState icon={Music2} title="No tracks here yet" body="Bring in a work from your library or upload something new." action="Add a track" onClick={() => onOpen('library')} />}</div><div className="mt-5 pt-4 border-t border-white/[.08] flex items-center gap-3 text-xs text-muted-foreground"><Globe2 size={14} className="text-primary" /> Public collection <span className="ml-auto">Last edited 2 days ago</span></div></section><div className="grid md:grid-cols-3 gap-3 mt-6"><ActionCard icon={CloudUpload} title="Upload a new cut" body="Audio, video, or a private sketch." onClick={() => onOpen('upload')} /><ActionCard icon={RefreshCw} title="Import from elsewhere" body="Bring in SoundCloud or Bandcamp links." onClick={() => onNotify('Import link copied — paste it into the library when ready.')} /><ActionCard icon={ListMusic} title="Build a smart playlist" body="Let your catalog tell a story." onClick={() => onNotify('Smart playlist builder is ready for your catalog.')} /></div></div>;
}
