/**
 * Shared player/library types + pure helpers, ported field-for-field from
 * studio/src/lib/hooks/usePlayerEngine.ts and studio/src/lib/library.ts so
 * mobile speaks the same shapes as the web player against the same backend
 * endpoints (src/api/stream.js, src/api/library.js).
 */

export type StationTrack = {
  id: number;
  title: string;
  artist: string | null;
  category: string | null;
  duration: number | null;
  isVideo?: boolean;
};

export type NowPlaying = StationTrack & { startedAt?: string | null };

export type StreamStatus = {
  nowPlaying: NowPlaying | null;
  listenerCount: number;
  liveActive: boolean;
  liveStartedAt: string | null;
  liveVideoActive: boolean;
  liveVideoSource: 'browser' | 'rtmp' | null;
  videoLive: { active: boolean; startedAt: string | null; minTier: string };
  isVideo: boolean;
  mode: 'shuffle' | 'scheduled';
  stationQueue: StationTrack[];
  recentlyPlayed: (StationTrack & { playedAt: string })[];
};

export type LibraryItem = {
  id: number;
  title: string;
  artist: string | null;
  album: string | null;
  genre: string | null;
  producer: string | null;
  credits: string | null;
  artwork_url: string | null;
  category: string | null;
  duration: number | null;
  bpm: number | null;
  tags: string[];
  visibility: 'public' | 'supporters_only' | 'vault';
  mimeType: string | null;
  isVideo: boolean;
  isVault: boolean;
  isExternal: boolean;
  offlineAllowed: boolean;
  previewUrl: string;
  indexedAt: string;
  downloadUrl?: string;
  unlocked?: boolean;
  price?: {
    suggested: number;
    minimum: number;
    allowFree: boolean;
    paymentType: string;
    recurringInterval: string | null;
    currency: string;
  };
};

export type LibraryProject = { id: number; name: string; description: string | null; tracks: LibraryItem[] };
export type LibraryStructure = { projects: LibraryProject[]; standalone: LibraryItem[]; curated?: unknown };

export type OnDemandTrack = {
  id: number;
  title: string;
  artist: string | null;
  category: string | null;
  duration: number | null;
  visibility: 'public' | 'supporters_only' | 'vault';
  unlocked?: boolean;
  isExternal?: boolean;
  isVideo?: boolean;
  mimeType?: string | null;
};

export type QuotaSnapshot = {
  limit: number | null;
  remaining: number | null;
  resetSec: number;
  nextUpAvailable?: boolean;
  emailRequired?: boolean;
  unlimited?: boolean;
};

export type PlaybackKind = 'audio' | 'video';
export type PlaybackSource = 'station' | 'live-audio' | 'live-video';
export type ActivePlayback = { source: PlaybackSource; kind: PlaybackKind; url: string };

type PlayabilityFields = { visibility: 'public' | 'supporters_only' | 'vault'; unlocked?: boolean; isExternal?: boolean };

/** Ported verbatim from studio/src/lib/hooks/usePlayerEngine.ts. */
export function isPlayableTrack(track: PlayabilityFields, isPaid: boolean): boolean {
  if (track.isExternal) return false;
  if (track.visibility === 'public') return true;
  if (track.visibility === 'supporters_only') return track.unlocked === true || isPaid;
  if (track.visibility === 'vault') return track.unlocked === true;
  return true;
}

type StashableFields = {
  visibility?: 'public' | 'supporters_only' | 'vault';
  unlocked?: boolean;
  isExternal?: boolean;
  offlineAllowed?: boolean;
};

/**
 * Ported verbatim from studio/src/lib/hooks/usePlayerEngine.ts: a track can
 * be saved for offline playback if it's actually playable for this listener,
 * and either the creator marked it offline-allowed or it's an individually
 * unlocked vault item.
 */
export function canStash(track: StashableFields, isPaid: boolean): boolean {
  const playable = isPlayableTrack({ ...track, visibility: track.visibility || 'public' }, isPaid);
  return playable && (!!track.offlineAllowed || (track.visibility === 'vault' && track.unlocked === true));
}

const SWATCHES = ['#a9d647', '#ff816e', '#818cf3', '#e7a85b', '#6dc0bd', '#8e8cf5'];

/** Ported from studio/src/lib/library.ts — cycles a fixed color array for track-tile accents. */
export function swatchFor(id: number): string {
  return SWATCHES[id % SWATCHES.length];
}

/** Ported from studio/src/lib/library.ts. */
export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || !Number.isFinite(seconds)) return '—:—';
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function toOnDemandTrack(item: LibraryItem): OnDemandTrack {
  return {
    id: item.id,
    title: item.title,
    artist: item.artist,
    category: item.category,
    duration: item.duration,
    visibility: item.visibility || 'public',
    unlocked: item.unlocked,
    isExternal: item.isExternal,
    isVideo: item.isVideo,
    mimeType: item.mimeType,
  };
}
