import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { createVideoPlayer, type VideoPlayer } from 'expo-video';

import { StationClientError, type StationClient } from '@/api/stationClient';
import { canStash, type LibraryItem } from '@/player/types';
import type { StashRecord } from '@/stash/types';

/**
 * RN analog of studio/src/lib/hooks/useOfflineSaves.ts — but files-on-disk +
 * AsyncStorage metadata instead of IndexedDB Blobs, and keyed by
 * (canonicalStationBaseUrl, trackId) instead of trackId alone so the Stash
 * aggregates across every station visited on the phone (the web hook only
 * ever deals with one station per browser tab, so it doesn't need this).
 */

const STORAGE_KEY = 'paperweight.stash.v1';

/**
 * Canonicalization rule (load-bearing for correct de-dup/aggregation — see
 * docs/plans/2026-08-17-mobile-app-implementation-plan.md Phase 4 gotchas):
 * lowercase scheme + host, strip the default port (443/80) and any trailing
 * slash(es) from the path, drop query/hash. Two differently-formed URLs for
 * the same physical station (e.g. a manual LAN IP vs. System.Pape's
 * publicUrl) will NOT collide unless they canonicalize identically — true
 * station-identity resolution is out of scope.
 */
export function canonicalizeBaseUrl(raw: string): string {
  const u = new URL(raw.trim());
  const protocol = u.protocol.toLowerCase();
  const host = u.hostname.toLowerCase();
  const defaultPort = protocol === 'https:' ? '443' : '80';
  const port = u.port && u.port !== defaultPort ? `:${u.port}` : '';
  const path = u.pathname.replace(/\/+$/, '');
  return `${protocol}//${host}${port}${path}`;
}

function stashKey(canonicalBaseUrl: string, trackId: number): string {
  return `${canonicalBaseUrl}::${trackId}`;
}

function extensionForMime(mime: string | null | undefined): string {
  const map: Record<string, string> = {
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/aac': 'aac',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/ogg': 'ogg',
    'audio/webm': 'webm',
    'audio/flac': 'flac',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov',
  };
  return map[(mime || '').toLowerCase()] || 'bin';
}

function stashDir(): Directory {
  const dir = new Directory(Paths.document, 'stash');
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

async function loadRecords(): Promise<StashRecord[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StashRecord[]) : [];
  } catch {
    return [];
  }
}

async function saveRecords(records: StashRecord[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(records)).catch(() => undefined);
}

export type StashStoreOptions = {
  stationClient: StationClient | null;
  station: { baseUrl: string; name: string } | null;
  isPaid: boolean;
  onNotify?: (message: string) => void;
};

export type StashStore = {
  records: StashRecord[];
  savedKeys: Set<string>;
  playingKey: string | null;
  totalSizeBytes: number;
  refresh: () => Promise<void>;
  save: (track: LibraryItem) => Promise<boolean>;
  remove: (key: string) => Promise<boolean>;
  play: (key: string) => Promise<boolean>;
  stop: () => void;
};

export function useStashStoreState(options: StashStoreOptions): StashStore {
  const { stationClient, station, isPaid, onNotify } = options;
  const [records, setRecords] = useState<StashRecord[]>([]);
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const scratchPlayerRef = useRef<AudioPlayer | VideoPlayer | null>(null);

  const refresh = useCallback(async () => {
    setRecords(await loadRecords());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const stop = useCallback(() => {
    if (scratchPlayerRef.current) {
      scratchPlayerRef.current.pause();
      scratchPlayerRef.current.release(); // AudioPlayer and VideoPlayer both extend SharedObject
      scratchPlayerRef.current = null;
    }
    setPlayingKey(null);
  }, []);

  const save = useCallback(
    async (track: LibraryItem) => {
      if (!stationClient || !station) {
        onNotify?.('No station selected.');
        return false;
      }
      if (!canStash(track, isPaid)) {
        onNotify?.('This track is not available for offline saving.');
        return false;
      }
      const canonicalBaseUrl = canonicalizeBaseUrl(station.baseUrl);
      const key = stashKey(canonicalBaseUrl, track.id);
      try {
        const { signedUrl } = await stationClient.downloadUrl(track.id);
        const absoluteUrl = stationClient.resolveUrl(signedUrl);
        const ext = extensionForMime(track.mimeType);
        const destination = new File(stashDir(), `${track.id}-${Math.abs(hashString(canonicalBaseUrl))}.${ext}`);
        if (destination.exists) destination.delete(); // re-save overwrites cleanly rather than relying on task-level idempotency
        const task = File.createDownloadTask(absoluteUrl, destination);
        const file = await task.downloadAsync();
        if (!file) {
          onNotify?.('Save was paused before it finished.');
          return false;
        }
        const record: StashRecord = {
          key,
          canonicalBaseUrl,
          stationName: station.name,
          trackId: track.id,
          title: track.title,
          artist: track.artist,
          mimeType: track.mimeType,
          sizeBytes: file.size,
          localUri: file.uri,
          savedAt: new Date().toISOString(),
        };
        const next = [...(await loadRecords()).filter((r) => r.key !== key), record];
        await saveRecords(next);
        setRecords(next);
        onNotify?.('Saved for offline playback');
        return true;
      } catch (err) {
        const message = err instanceof StationClientError ? (err.data as { error?: string } | undefined)?.error : null;
        onNotify?.(message || 'Save failed — check your connection');
        return false;
      }
    },
    [stationClient, station, isPaid, onNotify]
  );

  const remove = useCallback(
    async (key: string) => {
      try {
        const all = await loadRecords();
        const record = all.find((r) => r.key === key);
        if (record) {
          try {
            new File(record.localUri).delete();
          } catch {
            // File already gone — still drop the metadata below.
          }
        }
        if (playingKey === key) stop();
        const next = all.filter((r) => r.key !== key);
        await saveRecords(next);
        setRecords(next);
        return true;
      } catch {
        return false;
      }
    },
    [playingKey, stop]
  );

  const play = useCallback(
    async (key: string) => {
      const record = records.find((r) => r.key === key);
      if (!record) return false;
      stop();
      const isVideo = (record.mimeType || '').startsWith('video/');
      const player = isVideo ? createVideoPlayer({ uri: record.localUri }) : createAudioPlayer({ uri: record.localUri });
      scratchPlayerRef.current = player;
      player.play();
      setPlayingKey(key);
      return true;
    },
    [records, stop]
  );

  useEffect(() => () => stop(), [stop]);

  const savedKeys = useMemo(() => new Set(records.map((r) => r.key)), [records]);
  const totalSizeBytes = useMemo(() => records.reduce((sum, r) => sum + (r.sizeBytes || 0), 0), [records]);

  return { records, savedKeys, playingKey, totalSizeBytes, refresh, save, remove, play, stop };
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return h;
}
