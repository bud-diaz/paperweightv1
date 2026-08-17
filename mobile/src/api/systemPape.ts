/**
 * Cross-station directory/search against System.Pape — the same public API
 * `landing/listen.html` calls (see that file's "Station directory / search"
 * script block). Individual stations have no knowledge of each other; this
 * is the only cross-station surface in the app.
 */

const API_BASE = 'https://system.paperweighthq.com/api/modules/paperweight';

export type DirectoryStation = {
  slug: string;
  name: string | null;
  url: string;
  live: boolean;
  listeners: number;
  nowPlaying: string | null;
};

function normalizeDirectoryEntry(raw: unknown): DirectoryStation {
  const r = raw as Record<string, unknown>;
  return {
    slug: typeof r?.slug === 'string' ? r.slug : '',
    name: null,
    url: typeof r?.publicUrl === 'string' ? r.publicUrl : '',
    live: Boolean(r?.broadcasting),
    listeners: Number(r?.listeners) || 0,
    nowPlaying: typeof r?.currentTrack === 'string' ? r.currentTrack : null,
  };
}

function normalizeSearchEntry(raw: unknown): DirectoryStation {
  const r = raw as Record<string, unknown>;
  return {
    slug: typeof r?.slug === 'string' ? r.slug : '',
    name: typeof r?.name === 'string' ? r.name : null,
    url: typeof r?.url === 'string' ? r.url : '',
    live: Boolean(r?.live),
    listeners: Number(r?.listeners) || 0,
    nowPlaying: typeof r?.nowPlaying === 'string' ? r.nowPlaying : null,
  };
}

/** Sorts live stations first, then by listener count — matches listen.html. */
export function sortStations(list: DirectoryStation[]): DirectoryStation[] {
  return [...list].sort((a, b) => Number(b.live) - Number(a.live) || b.listeners - a.listeners);
}

/** GET /directory — default listing of every station opted into search. */
export async function getDirectory(): Promise<DirectoryStation[]> {
  const res = await fetch(`${API_BASE}/directory`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Directory returned ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data.map(normalizeDirectoryEntry) : [];
}

/** GET /stations?q=&limit= — search by slug/name. */
export async function searchStations(query: string, limit = 20): Promise<DirectoryStation[]> {
  const url = new URL(`${API_BASE}/stations`);
  url.searchParams.set('q', query);
  url.searchParams.set('limit', String(limit));
  const res = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Station search returned ${res.status}`);
  const data = await res.json();
  return Array.isArray(data?.stations) ? data.stations.map(normalizeSearchEntry) : [];
}
