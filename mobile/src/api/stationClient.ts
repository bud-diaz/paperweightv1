/**
 * Fetch wrapper parameterized by a station's base URL (its `publicUrl` from
 * System.Pape, or a manually-entered override — see stationStore). The RN
 * analog of studio/src/lib/api.js's _fetch/_json/_send helpers, but without
 * that file's same-origin-cookie assumption: mobile has no shared origin
 * with any station, so every authenticated call attaches
 * `Authorization: Bearer <token>` explicitly instead of relying on cookies.
 */

import type { LibraryStructure, QuotaSnapshot, StreamStatus } from '@/player/types';

export class StationClientError extends Error {
  status: number;
  data: unknown;

  constructor(status: number, data: unknown) {
    super(`Station request failed (${status})`);
    this.status = status;
    this.data = data;
  }
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

export class StationClient {
  constructor(
    private baseUrl: string,
    private token?: string | null
  ) {}

  private url(path: string): string {
    return `${this.baseUrl.replace(/\/+$/, '')}${path}`;
  }

  /** Resolves a station-relative path (e.g. a signed download URL from downloadUrl()) to an absolute URL. */
  resolveUrl(path: string): string {
    return this.url(path);
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = { Accept: 'application/json', ...extra };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    return headers;
  }

  async get<T>(path: string): Promise<T> {
    const res = await fetch(this.url(path), { headers: this.headers() });
    if (!res.ok) throw new StationClientError(res.status, await safeJson(res));
    return res.json();
  }

  async post<T>(path: string, body?: unknown): Promise<{ res: Response; data: T }> {
    const res = await fetch(this.url(path), {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = (await safeJson(res)) as T;
    return { res, data };
  }

  /** GET /api/health — bootstrap/reachability check: station name + runtime health. */
  health(): Promise<{ station: string }> {
    return this.get('/api/health');
  }

  /** POST /api/listener/login — email/password login; returns a bearer token on success. */
  login(email: string, password: string) {
    return this.post<{ token?: string; tier?: string; error?: string }>('/api/listener/login', {
      email,
      password,
    });
  }

  /**
   * POST /api/tokens/redeem — creator-issued token redemption. The response
   * carries only { tier }, not the token itself (unlike login) — the raw
   * token the caller submits *is* the bearer credential, so the caller is
   * responsible for persisting the string it passed in on success.
   */
  redeemToken(token: string) {
    return this.post<{ tier?: string; error?: string }>('/api/tokens/redeem', { token });
  }

  /** GET /api/listener/me — current listener account details for the attached bearer token. */
  me(): Promise<{ email?: string; displayName?: string; hasAccount: boolean; hasPassword: boolean }> {
    return this.get('/api/listener/me');
  }

  /**
   * GET /api/stream/status — now-playing/recently-played/queue + live state,
   * polled every 10s by PlayerEngine. Public (no auth needed), but still
   * routed through this client so it's parameterized by the current station.
   */
  streamStatus(): Promise<StreamStatus> {
    return this.get('/api/stream/status');
  }

  /** POST /api/stream/ping — listener keep-alive while live audio/video is playing. */
  async ping(): Promise<{ listenerCount: number }> {
    const { data } = await this.post<{ listenerCount: number }>('/api/stream/ping');
    return data;
  }

  /** GET /api/library/structure — full catalog (projects + standalone tracks), backs Stack. */
  libraryStructure(): Promise<LibraryStructure> {
    return this.get('/api/library/structure');
  }

  /** GET /api/library/stream-quota — current on-demand play allowance for free-tier listeners. */
  streamQuota(): Promise<QuotaSnapshot> {
    return this.get('/api/library/stream-quota');
  }

  /**
   * GET /api/library/{id}/download — signed URL for saving a track locally (Stash).
   * Throws StationClientError (401/403/404, with a human-readable `.data.error`) when
   * the download isn't allowed — callers should catch and surface `.data?.error`.
   */
  downloadUrl(id: number): Promise<{ signedUrl: string }> {
    return this.get(`/api/library/${id}/download`);
  }

  /** Absolute URL for full on-demand streaming — handed to the audio/video player as a source, not fetched here. */
  streamUrl(id: number, opts: { nextUp?: boolean } = {}): string {
    return this.url(`/api/library/${encodeURIComponent(String(id))}/stream${opts.nextUp ? '?nextUp=1' : ''}`);
  }

  /** Absolute URL for a track's 30s preview stream (locked/unplayable tracks). */
  previewUrl(id: number): string {
    return this.url(`/api/library/${encodeURIComponent(String(id))}/preview`);
  }

  /** Absolute URL for a track's artwork image. */
  artworkUrl(id: number): string {
    return this.url(`/api/library/${encodeURIComponent(String(id))}/artwork`);
  }

  /** Absolute URL for a live HLS playlist — station-relative, not under /api. */
  hlsUrl(kind: 'station' | 'live' | 'live-video'): string {
    const path = kind === 'station' ? '/hls/stream/index.m3u8' : kind === 'live' ? '/hls/live/index.m3u8' : '/hls/live-video/index.m3u8';
    return this.url(path);
  }

  /**
   * Bearer header for media sources (expo-audio/expo-video's `AudioSource.headers`/
   * `VideoSource.headers`) — leaner than this.headers(), which also sets Accept/JSON
   * for the client's own fetches.
   */
  authHeader(): Record<string, string> | undefined {
    return this.token ? { Authorization: `Bearer ${this.token}` } : undefined;
  }
}

export function createStationClient(baseUrl: string, token?: string | null): StationClient {
  return new StationClient(baseUrl, token);
}
