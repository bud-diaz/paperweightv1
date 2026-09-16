/**
 * Cross-station directory/search against System.Pape.
 *
 * Unlike `landing/listen.html` — which calls the free, unauthenticated
 * `/directory` and `/stations` endpoints and is unaffected by any of this —
 * the app calls the `/app/*` variants. Those return only stations with an
 * active app-listing entitlement and no moderation suspension.
 *
 * That filtering is done server-side, inside System.Pape, on purpose: a station
 * pulled for content reasons disappears for every already-installed app version
 * on its next fetch, which a client-side eligibility flag could not achieve. See
 * `docs/system-pape-contract.md` and System.Pape's
 * `docs/paperweight-app-listing-eligibility.md`.
 *
 * Individual stations have no knowledge of each other; this is the only
 * cross-station surface in the app.
 */

import Constants from 'expo-constants';
import { Platform } from 'react-native';

const API_BASE = 'https://system.paperweighthq.com/api/modules/paperweight';
const APP_BASE = `${API_BASE}/app`;

/**
 * Client identifier for the official app build. Not a secret — it ships inside
 * the binary and is extractable — and it is not what makes the paid listing
 * enforceable; that is the server-side eligibility computation. It exists so
 * System.Pape can revoke a bad build's discovery remotely, count app vs. web
 * directory traffic separately, and rate-limit the app on its own bucket.
 *
 * Supplied at build time via EAS (`EXPO_PUBLIC_PAPE_APP_KEY`), so it is not
 * committed to the repo.
 */
const APP_KEY = process.env.EXPO_PUBLIC_PAPE_APP_KEY ?? '';
const APP_VERSION = Constants.expoConfig?.version ?? '0.0.0';

function appHeaders(): Record<string, string> {
  return {
    Accept: 'application/json',
    'x-pape-app-key': APP_KEY,
    'x-pape-app-version': APP_VERSION,
    'x-pape-app-platform': Platform.OS,
  };
}

export type DirectoryStation = {
  slug: string;
  name: string | null;
  url: string;
  live: boolean;
  listeners: number;
  nowPlaying: string | null;
};

/**
 * Why a directory call failed, so Discover can say something true instead of a
 * blanket "unreachable":
 *  - `upgrade-required` — this build is below System.Pape's minimum version.
 *  - `unavailable`      — this build is not a recognized client (revoked key),
 *                         or the directory is not configured server-side.
 *  - `network`          — everything else: offline, DNS, 5xx, bad JSON.
 */
export type DirectoryErrorKind = 'upgrade-required' | 'unavailable' | 'network';

export class DirectoryError extends Error {
  readonly kind: DirectoryErrorKind;

  constructor(kind: DirectoryErrorKind, message: string) {
    super(message);
    this.name = 'DirectoryError';
    this.kind = kind;
  }
}

function errorForStatus(status: number): DirectoryError {
  if (status === 426) {
    return new DirectoryError('upgrade-required', 'This version of the app is out of date.');
  }
  // 403: unrecognized/revoked app key. 503: no app keys configured upstream.
  // Both mean "this client cannot use discovery right now" and neither is
  // something a retry will fix.
  if (status === 403 || status === 503) {
    return new DirectoryError('unavailable', 'Station discovery is unavailable for this app version.');
  }
  return new DirectoryError('network', `Directory returned ${status}`);
}

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

/** GET /app/directory — app-eligible stations. Same response shape as /directory. */
export async function getDirectory(): Promise<DirectoryStation[]> {
  const res = await fetch(`${APP_BASE}/directory`, { headers: appHeaders() });
  if (!res.ok) throw errorForStatus(res.status);
  const data = await res.json();
  return Array.isArray(data) ? data.map(normalizeDirectoryEntry) : [];
}

/** GET /app/stations?q=&limit= — search within app-eligible stations. */
export async function searchStations(query: string, limit = 20): Promise<DirectoryStation[]> {
  const url = new URL(`${APP_BASE}/stations`);
  url.searchParams.set('q', query);
  url.searchParams.set('limit', String(limit));
  const res = await fetch(url.toString(), { headers: appHeaders() });
  if (!res.ok) throw errorForStatus(res.status);
  const data = await res.json();
  return Array.isArray(data?.stations) ? data.stations.map(normalizeSearchEntry) : [];
}
