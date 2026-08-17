import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Directory, File, Paths } from 'expo-file-system';
import { useCallback, useEffect, useMemo, useState } from 'react';

import type { StationClient } from '@/api/stationClient';

// RN analog of studio/src/lib/hooks/useOfflineSaves.ts: the server issues a
// short-lived signed URL (GET /api/library/:id/download) for tracks the
// creator marked offline_allowed (or an individually unlocked vault item),
// the file is downloaded once via expo-file-system, and playback uses its
// own expo-audio player instance so it never shares state with
// PlayerEngine's live/on-demand player — same separation the web hook keeps
// between its local <audio> element and the main player engine.

const STORAGE_KEY = 'paperweight.stashStore.v1';
const STASH_DIR_NAME = 'stash';

/**
 * Canonicalizes a station base URL (scheme + host + non-default port, no
 * trailing slash, no path) so Stash correctly aggregates the same station
 * reached via different casing/trailing-slash/manual-URL forms, without
 * conflating two different stations. Load-bearing for de-dup — see Phase 4
 * plan's gotcha.
 */
export function canonicalizeBaseUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const scheme = u.protocol.toLowerCase();
    const defaultPort = scheme === 'https:' ? '443' : '80';
    const port = u.port && u.port !== defaultPort ? `:${u.port}` : '';
    return `${scheme}//${u.hostname.toLowerCase()}${port}`;
  } catch {
    return raw.trim().replace(/\/+$/, '').toLowerCase();
  }
}

function stashKey(canonicalBaseUrl: string, trackId: number): string {
  return `${canonicalBaseUrl}::${trackId}`;
}

function extensionForMime(mimeType: string | null | undefined): string {
  switch (mimeType) {
    case 'audio/mpeg':
      return 'mp3';
    case 'audio/mp4':
    case 'audio/x-m4a':
      return 'm4a';
    case 'audio/wav':
    case 'audio/x-wav':
      return 'wav';
    case 'audio/ogg':
      return 'ogg';
    case 'audio/flac':
    case 'audio/x-flac':
      return 'flac';
    case 'audio/aac':
      return 'aac';
    default:
      return 'audio';
  }
}

export type StashRecord = {
  key: string;
  stationBaseUrl: string;
  stationName: string;
  trackId: number;
  title: string;
  artist: string | null;
  mimeType: string | null;
  size: number;
  localUri: string;
  savedAt: string;
};

export type SavableStashTrack = {
  id: number;
  title: string;
  artist: string | null;
  mimeType?: string | null;
};

function stashDirectory(): Directory {
  return new Directory(Paths.document, STASH_DIR_NAME);
}

async function readRecords(): Promise<StashRecord[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StashRecord[]) : [];
  } catch {
    return [];
  }
}

async function writeRecords(records: StashRecord[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

export function useStashStore(onNotify: (message: string) => void) {
  const [hydrated, setHydrated] = useState(false);
  const [records, setRecords] = useState<StashRecord[]>([]);
  const [playingKey, setPlayingKey] = useState<string | null>(null);

  const localPlayer = useAudioPlayer(null, { updateInterval: 500 });
  const localPlayerStatus = useAudioPlayerStatus(localPlayer);

  useEffect(() => {
    let cancelled = false;
    readRecords()
      .then((r) => {
        if (!cancelled) setRecords(r);
      })
      .finally(() => {
        if (!cancelled) setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const stop = useCallback(() => {
    localPlayer.pause();
    setPlayingKey(null);
  }, [localPlayer]);

  // A locally-played track reaching its end should stop, not sit paused at
  // the tail — there's no "revert to live" concept for Stash playback.
  useEffect(() => {
    if (playingKey && localPlayerStatus.didJustFinish) stop();
  }, [playingKey, localPlayerStatus.didJustFinish, stop]);

  const savedKeys = useMemo(() => new Set(records.map((r) => r.key)), [records]);
  const totalBytes = useMemo(() => records.reduce((sum, r) => sum + r.size, 0), [records]);

  const isSaved = useCallback((baseUrl: string, trackId: number) => savedKeys.has(stashKey(canonicalizeBaseUrl(baseUrl), trackId)), [savedKeys]);

  const save = useCallback(
    async (track: SavableStashTrack, baseUrl: string, stationName: string, client: StationClient) => {
      const canonicalBaseUrl = canonicalizeBaseUrl(baseUrl);
      const key = stashKey(canonicalBaseUrl, track.id);
      try {
        const { signedUrl, error } = await client.downloadUrl(track.id);
        if (!signedUrl) {
          onNotify(error || 'Saving not available for this track');
          return false;
        }
        const absoluteUrl = new URL(signedUrl, baseUrl).toString();
        const dir = stashDirectory();
        if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
        const dest = new File(dir, `${encodeURIComponent(key)}.${extensionForMime(track.mimeType)}`);
        const downloaded = await File.downloadFileAsync(absoluteUrl, dest, { idempotent: true });
        const record: StashRecord = {
          key,
          stationBaseUrl: canonicalBaseUrl,
          stationName,
          trackId: track.id,
          title: track.title,
          artist: track.artist,
          mimeType: track.mimeType ?? null,
          size: downloaded.size,
          localUri: downloaded.uri,
          savedAt: new Date().toISOString(),
        };
        const next = [record, ...records.filter((r) => r.key !== key)];
        setRecords(next);
        await writeRecords(next);
        onNotify('Saved for offline playback');
        return true;
      } catch {
        onNotify('Save failed — check your connection');
        return false;
      }
    },
    [records, onNotify]
  );

  const remove = useCallback(
    async (key: string) => {
      const record = records.find((r) => r.key === key);
      if (playingKey === key) stop();
      if (record) {
        try {
          new File(record.localUri).delete();
        } catch {
          // Best-effort — a missing file on disk shouldn't block clearing the record.
        }
      }
      const next = records.filter((r) => r.key !== key);
      setRecords(next);
      await writeRecords(next);
    },
    [records, playingKey, stop]
  );

  const clearAll = useCallback(async () => {
    stop();
    try {
      const dir = stashDirectory();
      if (dir.exists) dir.delete();
    } catch {
      // Best-effort — proceed to clear the index either way.
    }
    setRecords([]);
    await writeRecords([]);
  }, [stop]);

  const removeForTrack = useCallback((baseUrl: string, trackId: number) => remove(stashKey(canonicalizeBaseUrl(baseUrl), trackId)), [remove]);

  const play = useCallback(
    (key: string) => {
      const record = records.find((r) => r.key === key);
      if (!record) return;
      localPlayer.replace({ uri: record.localUri });
      localPlayer.play();
      setPlayingKey(key);
    },
    [records, localPlayer]
  );

  return {
    hydrated,
    records,
    savedKeys,
    totalBytes,
    playingKey,
    playing: playingKey !== null && localPlayerStatus.playing,
    isSaved,
    save,
    remove,
    removeForTrack,
    clearAll,
    play,
    stop,
  };
}

export type StashStore = ReturnType<typeof useStashStore>;
