/**
 * Fetch wrapper parameterized by a station's base URL (its `publicUrl` from
 * System.Pape, or a manually-entered override — see stationStore). The RN
 * analog of studio/src/lib/api.js's _fetch/_json/_send helpers, but without
 * that file's same-origin-cookie assumption: mobile has no shared origin
 * with any station, so every authenticated call attaches
 * `Authorization: Bearer <token>` explicitly instead of relying on cookies.
 */

export type StationTrack = {
  id: number;
  title: string;
  artist: string | null;
  category: string | null;
  duration: number | null;
  isVideo: boolean;
};

export type NowPlayingTrack = StationTrack & { startedAt?: string | null };

export type RecentlyPlayedTrack = {
  id: number;
  title: string;
  artist: string | null;
  category: string | null;
  playedAt: string;
};

export type CreatorPost = {
  id: number;
  title: string | null;
  body: string;
  visibility: 'public' | 'supporters_only';
  published_at: string;
};

export type StreamStatus = {
  isLive: boolean;
  mode: 'shuffle' | 'scheduled';
  isVideo: boolean;
  recentlyPlayed: RecentlyPlayedTrack[];
  stationQueue: StationTrack[];
  nowPlaying: NowPlayingTrack | null;
  updatedAt: string;
  liveActive: boolean;
  liveStartedAt: string | null;
  liveVideoActive: boolean;
  listenerCount: number;
};

/** One row from GET /api/library/structure — field set per src/api/library.js's formatItem(). */
export type LibraryTrack = {
  id: number;
  title: string;
  artist: string | null;
  album: string | null;
  genre: string | null;
  category: string | null;
  duration: number | null;
  visibility: 'public' | 'supporters_only' | 'vault';
  mimeType: string | null;
  isVideo: boolean;
  isExternal: boolean;
  offlineAllowed: boolean;
  unlocked?: boolean;
  downloadUrl?: string;
};

export type LibraryProject = {
  id: number;
  name: string;
  description: string | null;
  tracks: LibraryTrack[];
};

export type LibraryStructure = {
  projects: LibraryProject[];
  standalone: LibraryTrack[];
};

/**
 * GET /api/listener/me response — field set per src/api/listener.js.
 * `hasAccount: false` covers "profile only" listeners (a display name/email
 * saved from the welcome page, no full account yet) — several fields are
 * always null/false in that shape since they only apply to full accounts.
 */
export type ListenerMe = {
  email: string | null;
  displayName: string | null;
  tier: string;
  hasAccount: boolean;
  hasPassword: boolean;
  marketingOptIn: boolean;
  subscriptionStatus: string | null;
  currentPeriodEnd: string | null;
  provider: string | null;
  emailVerified?: boolean;
  emailVerificationRequiredAt?: string | null;
  settingsTourSeenAt?: string | null;
};

function stripTrailingSlash(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

/** GET /hls/stream/index.m3u8 — the station's shuffled/scheduled rotation. */
export function hlsStationUrl(baseUrl: string): string {
  return `${stripTrailingSlash(baseUrl)}/hls/stream/index.m3u8`;
}

/** GET /hls/live/index.m3u8 — a creator's live mic/RTMP audio broadcast, when `liveActive`. */
export function hlsLiveAudioUrl(baseUrl: string): string {
  return `${stripTrailingSlash(baseUrl)}/hls/live/index.m3u8`;
}

/**
 * GET /api/library/:id/stream — on-demand track playback (range-request
 * capable direct file stream, not HLS). May 403 (vault/tier gate) or 429
 * (free-tier hourly quota) — both are surfaced as a player status `error`,
 * not thrown here, since this only builds the URL for the native player.
 */
export function libraryStreamUrl(baseUrl: string, trackId: number, opts?: { nextUp?: boolean }): string {
  const suffix = opts?.nextUp ? '?nextUp=1' : '';
  return `${stripTrailingSlash(baseUrl)}/api/library/${encodeURIComponent(String(trackId))}/stream${suffix}`;
}

/** GET /api/library/:id/preview — server-capped ~60s preview of a locked track; client stops itself at 30s. */
export function libraryPreviewUrl(baseUrl: string, trackId: number): string {
  return `${stripTrailingSlash(baseUrl)}/api/library/${encodeURIComponent(String(trackId))}/preview`;
}

/** GET /api/library/:id/artwork — per-track artwork, falls back server-side to a bundled default. */
export function libraryArtworkUrl(baseUrl: string, trackId: number): string {
  return `${stripTrailingSlash(baseUrl)}/api/library/${encodeURIComponent(String(trackId))}/artwork`;
}

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
  me(): Promise<ListenerMe> {
    return this.get('/api/listener/me');
  }

  /**
   * POST /api/listener/resend-verification — requires login; quietly no-ops
   * if already verified or the station has no SMTP configured (same
   * no-enumeration style as the password-reset flow), so the response is
   * intentionally not very informative either way.
   */
  async resendVerification(): Promise<{ ok?: boolean; error?: string }> {
    const { data } = await this.post<{ ok?: boolean; error?: string }>('/api/listener/resend-verification');
    return data;
  }

  /** GET /api/stream/status — now-playing/queue/live state; unauthenticated, polled every 10s by PlayerEngine. */
  streamStatus(): Promise<StreamStatus> {
    return this.get('/api/stream/status');
  }

  /** POST /api/stream/ping — listener keep-alive while live/station audio is actively playing; fire-and-forget. */
  async ping(): Promise<void> {
    await this.post('/api/stream/ping', undefined);
  }

  /** GET /api/posts — creator text updates, no attachments; `supporters_only` ones only come back when the attached bearer token's tier qualifies. */
  listPosts(page = 1, limit = 20): Promise<{ posts: CreatorPost[]; page: number; limit: number }> {
    return this.get(`/api/posts?page=${page}&limit=${limit}`);
  }

  /** GET /api/library/structure — full catalog (projects + standalone tracks) visible to the attached bearer token's tier. */
  libraryStructure(): Promise<LibraryStructure> {
    return this.get('/api/library/structure');
  }

  /**
   * GET /api/library/:id/download — mints a short-lived, self-authorizing
   * signed URL for saving a track to Stash. Requires a listener identity
   * (401 without one) and 403s if the track isn't actually download-eligible
   * — surfaced as `{ error }` rather than thrown, same shape as web's
   * api.library.downloadUrl, since callers need to show the error inline.
   */
  async downloadUrl(id: number): Promise<{ signedUrl?: string; error?: string }> {
    const res = await fetch(this.url(`/api/library/${id}/download`), { headers: this.headers() });
    return (await safeJson(res)) as { signedUrl?: string; error?: string };
  }
}

export function createStationClient(baseUrl: string, token?: string | null): StationClient {
  return new StationClient(baseUrl, token);
}
