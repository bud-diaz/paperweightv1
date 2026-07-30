/**
 * offline.js — Local saves for browser-based offline playback.
 *
 * Tracks the creator has marked offline_allowed can be saved by any listener
 * who can access them: the server issues a short-lived signed URL
 * (GET /api/library/:id/download) and the full file is stored in IndexedDB.
 * Playback of a saved copy uses its own <audio>/<video> element via an object
 * URL so it never interferes with the live-stream player.
 *
 * Saving requires a listener identity (welcome-page profile or account) —
 * the signed URL context is token-bound, so anonymous visitors can stream
 * but not save.
 */

import { showToast } from './utils.js';
import * as api from './api.js';

const DB_NAME  = 'paperweight-offline';
const STORE    = 'tracks';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const result = fn(store);
    t.oncomplete = () => resolve(result?.result ?? result);
    t.onerror    = () => reject(t.error);
  });
}

/** Returns Set of saved media ids. */
export async function savedIds() {
  try {
    const db = await openDb();
    const keys = await tx(db, 'readonly', store => store.getAllKeys());
    return new Set(keys || []);
  } catch { return new Set(); }
}

export async function getSaved(id) {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror   = () => reject(req.error);
    });
  } catch { return null; }
}

export async function listSaved() {
  try {
    const db = await openDb();
    return await tx(db, 'readonly', store => store.getAll());
  } catch { return []; }
}

/**
 * Fetch the full file through the signed-URL flow and store it locally.
 * @param {{ id, title, mimeType }} t
 * @returns {Promise<boolean>} true on success
 */
export async function saveTrack(t) {
  try {
    const { res, data } = await api.library.downloadUrl(t.id);
    if (!res.ok || !data.signedUrl) {
      showToast(data.error || 'Saving not available for this track');
      return false;
    }
    const fileRes = await fetch(data.signedUrl);
    if (!fileRes.ok) { showToast('Could not fetch the file'); return false; }
    const blob = await fileRes.blob();

    const db = await openDb();
    await tx(db, 'readwrite', store => store.put({
      id: t.id,
      title: t.title || `Track #${t.id}`,
      mimeType: blob.type || t.mimeType || 'audio/mpeg',
      size: blob.size,
      savedAt: new Date().toISOString(),
      blob,
    }));
    api.events.record('offline_saved', { mediaId: t.id, source: 'offline' });
    showToast('Saved for offline playback');
    return true;
  } catch {
    showToast('Save failed — check your connection');
    return false;
  }
}

export async function removeSaved(id) {
  try {
    const db = await openDb();
    await tx(db, 'readwrite', store => store.delete(id));
    return true;
  } catch { return false; }
}

// ── Local playback (separate element — never touches the live player) ────────

let localEl  = null;
let localUrl = null;
let playingId = null;

export function stopLocalPlayback() {
  if (localEl) { localEl.pause(); localEl.remove(); localEl = null; }
  if (localUrl) { URL.revokeObjectURL(localUrl); localUrl = null; }
  playingId = null;
}

export function localPlayingId() {
  return playingId;
}

/**
 * Play a saved copy. Returns true if playback started.
 * @param {number} id
 * @param {(ended: boolean) => void} [onStateChange] — called on end/stop
 */
export async function playSaved(id, onStateChange) {
  const rec = await getSaved(id);
  if (!rec) return false;

  stopLocalPlayback();
  localUrl = URL.createObjectURL(rec.blob);
  const isVideo = (rec.mimeType || '').startsWith('video/');
  localEl = document.createElement(isVideo ? 'video' : 'audio');
  if (isVideo) {
    localEl.controls = true;
    localEl.style.cssText = 'position:fixed;bottom:16px;right:16px;width:min(420px,90vw);z-index:9998;border:1px solid rgba(255,255,255,.2);border-radius:8px;background:#000;';
  } else {
    localEl.hidden = true;
  }
  localEl.src = localUrl;
  document.body.appendChild(localEl);
  localEl.addEventListener('ended', () => {
    stopLocalPlayback();
    if (onStateChange) onStateChange(true);
  });
  try {
    await localEl.play();
    playingId = id;
    return true;
  } catch {
    stopLocalPlayback();
    return false;
  }
}
