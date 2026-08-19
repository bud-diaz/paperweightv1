import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown, ArrowUp, CloudUpload, Disc3, Edit3, Globe2, ListMusic, ListX, LockKeyhole, Music2, Plus, RefreshCw,
} from 'lucide-react';

import { ActionCard, EmptyState, Field, Modal, TrackRow, ViewHeader, type TrackMenuAction } from '@/components/primitives';
import * as api from '@/lib/api';
import { toDisplayTrack, type LibraryStructure } from '@/lib/library';
import { cn } from '@/lib/utils';
import type { ModalKey } from '@/types';

const STANDALONE_KEY = -1;

type DashboardMediaItem = {
  id: number;
  title: string | null;
  filename: string;
  artist: string | null;
  album: string | null;
  genre: string | null;
  artwork_url: string | null;
};

function TrackEditModal({ track, collectionSize, onClose, onNotify }: { track: DashboardMediaItem; collectionSize: number; onClose: () => void; onNotify: (message: string) => void }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(track.title || track.filename);
  const [artist, setArtist] = useState(track.artist || '');
  const [genre, setGenre] = useState(track.genre || '');
  const [artworkUrl, setArtworkUrl] = useState(track.artwork_url || '');
  const [artFile, setArtFile] = useState<File | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      if (artFile) {
        const formData = new FormData();
        formData.append('artwork', artFile);
        const { res, data } = await api.dashboard.media.uploadArtwork(track.id, formData);
        if (!res.ok) return { res, data };
      }
      const sharedFields = [artist.trim() ? 'artist' : null, genre.trim() ? 'genre' : null, (artFile || artworkUrl.trim()) ? 'artwork' : null].filter(Boolean) as string[];
      const applyToCollection = collectionSize > 1 && sharedFields.length > 0 && window.confirm('Apply this artist, genre, and artwork to the other tracks in this collection?');
      return api.dashboard.media.update(track.id, {
        title: title.trim(),
        artist: artist.trim(),
        genre: genre.trim(),
        artwork_url: artworkUrl.trim(),
        apply_to_collection: applyToCollection,
        apply_fields: sharedFields,
      });
    },
    onSuccess: ({ res, data }: { res: Response; data: { error?: string; appliedToCollection?: number } }) => {
      if (!res.ok) { onNotify(data.error || 'Track update failed.'); return; }
      queryClient.invalidateQueries({ queryKey: ['library', 'structure'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'media'] });
      onNotify(data.appliedToCollection ? `Track updated and applied to ${data.appliedToCollection} collection track${data.appliedToCollection === 1 ? '' : 's'}.` : 'Track updated.');
      onClose();
    },
    onError: () => onNotify('Track update failed — connection error.'),
  });

  return <Modal title={`Edit “${track.title || track.filename}”`} eyebrow="Catalog / Track info" onClose={onClose} width="max-w-xl">
    <div className="space-y-5">
      <Field label="Title" value={title} onChange={setTitle} placeholder="Track title" />
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Artist" value={artist} onChange={setArtist} placeholder="Artist name" />
        <Field label="Genre" value={genre} onChange={setGenre} placeholder="Genre" />
      </div>
      <Field label="Artwork URL" value={artworkUrl} onChange={setArtworkUrl} placeholder="https://…" />
      <label className="block text-sm text-muted-foreground">Uploaded artwork<input type="file" accept="image/*" className="input-studio w-full rounded-xl px-3.5 py-3 mt-2" onChange={(event) => setArtFile(event.target.files?.[0] || null)} /></label>
      {collectionSize > 1 && <p className="text-xs text-muted-foreground">When you save, Paperweight will ask if you want Artist, Genre, and Artwork copied to the other tracks in this collection.</p>}
    </div>
    <div className="flex justify-end gap-2 mt-7">
      <button type="button" data-testid="button-cancel-track-info" onClick={onClose} className="ghost-button rounded-lg px-3 py-2 text-xs">Cancel</button>
      <button type="button" data-testid="button-save-track-info" onClick={() => save.mutate()} disabled={!title.trim() || save.isPending} className="lime-button rounded-lg px-4 py-2 text-xs font-semibold disabled:opacity-50">{save.isPending ? 'Saving…' : 'Save track info'}</button>
    </div>
  </Modal>;
}

export function Releases({ onOpen, onNotify, playing, onPlay, focusProjectId, onConsumeFocus, onManagePricing }: { onOpen: (modal: ModalKey) => void; onNotify: (message: string) => void; playing: boolean; onPlay: () => void; focusProjectId?: number | null; onConsumeFocus?: () => void; onManagePricing?: (projectId: number) => void }) {
  const queryClient = useQueryClient();
  const { data: structure, isLoading } = useQuery<LibraryStructure>({ queryKey: ['library', 'structure'], queryFn: () => api.library.structure() });
  const { data: mediaListRaw } = useQuery<DashboardMediaItem[]>({ queryKey: ['dashboard', 'media'], queryFn: () => api.dashboard.media.list() });
  const mediaList = Array.isArray(mediaListRaw) ? mediaListRaw : [];
  const [selected, setSelected] = useState<number | null>(null);
  const [editingTrackId, setEditingTrackId] = useState<number | null>(null);

  const projects = structure?.projects || [];
  const standalone = structure?.standalone || [];
  const hasAnything = projects.length > 0 || standalone.length > 0;

  useEffect(() => {
    if (selected !== null) return;
    if (projects.length) setSelected(projects[0].id);
    else if (standalone.length) setSelected(STANDALONE_KEY);
  }, [projects, standalone, selected]);

  useEffect(() => {
    if (focusProjectId == null) return;
    if (!projects.some((project) => project.id === focusProjectId)) return;
    setSelected(focusProjectId);
    onConsumeFocus?.();
  }, [focusProjectId, projects, onConsumeFocus]);

  const selectedProject = projects.find((project) => project.id === selected);
  const rawCollectionTracks = selected === STANDALONE_KEY ? standalone : (selectedProject?.tracks || []);
  const collectionTracks = selected === STANDALONE_KEY
    ? standalone.map((track) => toDisplayTrack(track, track.category || 'Standalone'))
    : rawCollectionTracks.map((track) => toDisplayTrack(track, selectedProject!.name));
  const editingTrack = mediaList.find((track) => track.id === editingTrackId) || null;

  const reorder = useMutation({
    mutationFn: ({ projectId, contentIds }: { projectId: number; contentIds: number[] }) => api.dashboard.vault.reorderCollectionTracks(projectId, { content_ids: contentIds }),
    onSuccess: ({ res, data }: { res: Response; data: { error?: string } }) => {
      if (!res.ok) { onNotify(data.error || 'Failed to reorder collection.'); return; }
      queryClient.invalidateQueries({ queryKey: ['library', 'structure'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'vault', 'pricing'] });
      onNotify('Collection order updated.');
    },
    onError: () => onNotify('Failed to reorder collection — connection error.'),
  });
  const moveTrack = (contentId: number, direction: -1 | 1) => {
    if (!selectedProject) return;
    const ids = selectedProject.tracks.map((track) => track.id);
    const index = ids.indexOf(contentId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= ids.length) return;
    const next = [...ids];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    reorder.mutate({ projectId: selectedProject.id, contentIds: next });
  };

  const removeFromCollection = useMutation({
    mutationFn: ({ projectId, contentId }: { projectId: number; contentId: number }) => api.dashboard.vault.removeCollectionTrack(projectId, contentId),
    onSuccess: ({ res, data }: { res: Response; data: { error?: string } }) => {
      if (!res.ok) { onNotify(data.error || 'Failed to remove track from collection.'); return; }
      queryClient.invalidateQueries({ queryKey: ['library', 'structure'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'vault', 'pricing'] });
      onNotify('Track removed from collection.');
    },
    onError: () => onNotify('Failed to remove track from collection — connection error.'),
  });

  return <div className="animate-enter"><ViewHeader eyebrow="Catalog / Releases" title="Your body of work." description="Shape the way people enter your world. Releases, broadcasts, and the fragments between." action={<button type="button" data-testid="button-create-collection" onClick={() => onOpen('collection')} className="lime-button rounded-xl px-4 py-2.5 text-sm font-semibold flex items-center gap-2"><Plus size={16} /> New collection</button>} />

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
          <div className="flex items-center gap-2">
            {selectedProject && onManagePricing && <button type="button" data-testid="button-manage-pricing" onClick={() => onManagePricing(selectedProject.id)} className="ghost-button rounded-lg px-3 py-2 text-xs flex items-center gap-2"><LockKeyhole size={14} /> Manage pricing</button>}
            <button type="button" data-testid="button-add-track" onClick={() => onOpen('library')} className="ghost-button rounded-lg px-3 py-2 text-xs flex items-center gap-2"><Plus size={14} /> Add track</button>
          </div>
        </div>
        <div className="mt-2">
          {collectionTracks.length ? collectionTracks.map((track, i) => {
            const menuActions: TrackMenuAction[] = selectedProject
              ? [{ label: 'Remove from collection', icon: ListX, destructive: true, onClick: () => removeFromCollection.mutate({ projectId: selectedProject.id, contentId: track.id }) }]
              : [];
            return <div key={track.id} className="flex items-center gap-2 border-b border-white/[.07] last:border-0">
            <div className="flex-1 min-w-0"><TrackRow track={track} index={i} playing={playing && i === 0} onPlay={onPlay} menuActions={menuActions} /></div>
            {selectedProject && <div className="flex items-center gap-1">
              <button type="button" aria-label={`Move ${track.title} up`} data-testid={`button-release-track-up-${track.id}`} onClick={() => moveTrack(track.id, -1)} disabled={i === 0 || reorder.isPending} className="ghost-button h-8 px-2 rounded-lg text-xs disabled:opacity-40"><ArrowUp size={13} /></button>
              <button type="button" aria-label={`Move ${track.title} down`} data-testid={`button-release-track-down-${track.id}`} onClick={() => moveTrack(track.id, 1)} disabled={i === collectionTracks.length - 1 || reorder.isPending} className="ghost-button h-8 px-2 rounded-lg text-xs disabled:opacity-40"><ArrowDown size={13} /></button>
            </div>}
            <button type="button" data-testid={`button-edit-track-info-${track.id}`} onClick={() => setEditingTrackId(track.id)} className="ghost-button h-8 px-2.5 rounded-lg text-xs flex items-center gap-1.5"><Edit3 size={13} /> Info</button>
          </div>;
          }) : <EmptyState icon={Music2} title="No tracks here yet" body="Bring in a work from your library or upload something new." action="Add a track" onClick={() => onOpen('library')} />}
        </div>
        {selected !== STANDALONE_KEY && <div className="mt-5 pt-4 border-t border-white/[.08] flex items-center gap-3 text-xs text-muted-foreground"><Globe2 size={14} className="text-primary" /> Use the arrows to set collection track order. Edit Info to copy Artist, Genre, and Artwork across the collection.</div>}
      </section>
    </>}

    <div className="grid md:grid-cols-3 gap-3 mt-6">
      <ActionCard icon={CloudUpload} title="Upload a new cut" body="Audio, video, or a private sketch." onClick={() => onOpen('upload')} />
      <ActionCard icon={RefreshCw} title="Import from elsewhere" body="Bring in SoundCloud or Bandcamp links." onClick={() => onNotify('Import link copied — paste it into the library when ready.')} />
      <ActionCard icon={ListMusic} title="Build a smart playlist" body="Let your catalog tell a story." onClick={() => onNotify('Smart playlist builder is wired in a later pass.')} />
    </div>
    {editingTrack && <TrackEditModal track={editingTrack} collectionSize={rawCollectionTracks.length} onClose={() => setEditingTrackId(null)} onNotify={onNotify} />}
  </div>;
}
