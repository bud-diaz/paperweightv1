import { useCallback, useEffect, useRef, useState } from 'react';

import * as api from '@/lib/api';

// Ports client/js/offline.js: browser-local saves for offline playback via
// IndexedDB. The server issues a short-lived signed URL
// (GET /api/library/:id/download) for tracks the creator marked
// offline_allowed; the full file is fetched once and stored as a Blob.
// Local playback uses its own <audio>/<video> element via an object URL so
// it never shares state with the live-station or on-demand engine — same
// separation usePlayerEngine already keeps between the live element and
// on-demand Audio() objects.

const DB_NAME = 'paperweight-offline';
const STORE = 'tracks';

export type OfflineRecord = { id: number; title: string; mimeType: string; size: number; savedAt: string };
type StoredRecord = OfflineRecord & { blob: Blob };

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T = unknown>(db: IDBDatabase, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = run(t.objectStore(STORE));
    t.oncomplete = () => resolve(req.result as T);
    t.onerror = () => reject(t.error);
  });
}

async function listSavedRecords(): Promise<StoredRecord[]> {
  try {
    const db = await openDb();
    return (await tx<StoredRecord[]>(db, 'readonly', (store) => store.getAll())) || [];
  } catch { return []; }
}

async function getSavedRecord(id: number): Promise<StoredRecord | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch { return null; }
}

export type SavableTrack = { id: number; title: string; mimeType?: string | null };

export function useOfflineSaves(onNotify: (message: string) => void) {
  const [savedIds, setSavedIds] = useState<Set<number>>(new Set());
  const [records, setRecords] = useState<OfflineRecord[]>([]);
  const [playingId, setPlayingId] = useState<number | null>(null);
  const localElRef = useRef<HTMLAudioElement | HTMLVideoElement | null>(null);
  const localUrlRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    const all = await listSavedRecords();
    setSavedIds(new Set(all.map((r) => r.id)));
    setRecords(all.map(({ blob: _blob, ...rest }) => rest).sort((a, b) => b.savedAt.localeCompare(a.savedAt)));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const stop = useCallback(() => {
    if (localElRef.current) { localElRef.current.pause(); localElRef.current.remove(); localElRef.current = null; }
    if (localUrlRef.current) { URL.revokeObjectURL(localUrlRef.current); localUrlRef.current = null; }
    setPlayingId(null);
  }, []);

  const save = useCallback(async (t: SavableTrack) => {
    try {
      const { res, data } = await api.library.downloadUrl(t.id);
      if (!res.ok || !data.signedUrl) { onNotify(data.error || 'Saving not available for this track'); return false; }
      const fileRes = await fetch(data.signedUrl);
      if (!fileRes.ok) { onNotify('Could not fetch the file'); return false; }
      const blob = await fileRes.blob();
      const db = await openDb();
      await tx(db, 'readwrite', (store) => store.put({
        id: t.id,
        title: t.title || `Track #${t.id}`,
        mimeType: blob.type || t.mimeType || 'audio/mpeg',
        size: blob.size,
        savedAt: new Date().toISOString(),
        blob,
      }));
      api.events.record('offline_saved', { mediaId: t.id, source: 'offline' }).catch(() => undefined);
      onNotify('Saved for offline playback');
      await refresh();
      return true;
    } catch {
      onNotify('Save failed — check your connection');
      return false;
    }
  }, [onNotify, refresh]);

  const remove = useCallback(async (id: number) => {
    try {
      const db = await openDb();
      await tx(db, 'readwrite', (store) => store.delete(id));
      if (playingId === id) stop();
      await refresh();
      return true;
    } catch { return false; }
  }, [playingId, stop, refresh]);

  const play = useCallback(async (id: number) => {
    const rec = await getSavedRecord(id);
    if (!rec) return false;
    stop();
    const url = URL.createObjectURL(rec.blob);
    localUrlRef.current = url;
    const isVideo = (rec.mimeType || '').startsWith('video/');
    const elem = document.createElement(isVideo ? 'video' : 'audio') as HTMLAudioElement | HTMLVideoElement;
    if (isVideo) {
      elem.controls = true;
      elem.style.cssText = 'position:fixed;bottom:16px;right:16px;width:min(420px,90vw);z-index:9998;border:1px solid rgba(255,255,255,.2);border-radius:8px;background:#000;';
    } else {
      elem.hidden = true;
    }
    elem.src = url;
    document.body.appendChild(elem);
    elem.addEventListener('ended', stop);
    localElRef.current = elem;
    try {
      await elem.play();
      setPlayingId(id);
      return true;
    } catch {
      stop();
      return false;
    }
  }, [stop]);

  useEffect(() => () => stop(), [stop]);

  return { savedIds, records, playingId, save, remove, play, stop, refresh };
}

export type OfflineSaves = ReturnType<typeof useOfflineSaves>;
