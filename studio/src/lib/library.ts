import type { Track } from '@/types';

export type LibraryItem = { id: number; title: string; artist: string | null; category: string | null; duration: number | null };
export type LibraryProject = { id: number; name: string; description: string | null; tracks: LibraryItem[] };
export type LibraryStructure = { projects: LibraryProject[]; standalone: LibraryItem[] };

const SWATCHES = ['#a9d647', '#ff816e', '#818cf3', '#e7a85b', '#6dc0bd', '#8e8cf5'];

export function swatchFor(id: number) {
  return SWATCHES[id % SWATCHES.length];
}

export function formatDuration(seconds: number | null | undefined) {
  if (!seconds || !Number.isFinite(seconds)) return '—:—';
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function toDisplayTrack(track: LibraryItem, collection: string): Track {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist || '',
    collection,
    duration: formatDuration(track.duration),
    plays: '—',
    color: swatchFor(track.id),
  };
}

export function toDisplayTracks(structure: LibraryStructure | undefined): Track[] {
  if (!structure) return [];
  const fromProjects = structure.projects.flatMap((project) => project.tracks.map((track) => toDisplayTrack(track, project.name)));
  const fromStandalone = structure.standalone.map((track) => toDisplayTrack(track, track.category || 'Library'));
  return [...fromProjects, ...fromStandalone];
}
