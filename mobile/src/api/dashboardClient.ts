/**
 * Bearer-attaching API client for requireDashboard-gated routes on the
 * station this phone is paired to (dashboardAuthStore) — a separate
 * identity from stationClient.ts's listening station. Mirrors
 * stationClient.ts's conventions (constructor(baseUrl, token), get/post
 * primitives, Authorization: Bearer header, one-line JSDoc per method
 * naming the route) with patch/put/del added, plus an onUnauthorized hook
 * so a 401 (device revoked from web Security.tsx) can trigger a clean
 * fall-back to StudioGate instead of an error loop.
 */

import { File, UploadType, type UploadProgress } from 'expo-file-system';

import type { StreamStatus } from '@/player/types';

export class DashboardClientError extends Error {
  status: number;
  data: unknown;

  constructor(status: number, data: unknown) {
    super(`Dashboard request failed (${status})`);
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

/** Row shape from GET /api/dashboard/media (src/api/dashboard.js) — snake_case, distinct from library.js's camelCase LibraryItem. */
export type DashboardMediaItem = {
  id: number;
  title: string | null;
  filename: string;
  category: string;
  visibility: 'public' | 'supporters_only' | 'vault';
  duration: number | null;
  artist: string | null;
  album: string | null;
  genre: string | null;
  producer: string | null;
  credits: string | null;
  artwork_url: string | null;
  tags: string | null;
  offline_allowed: number;
  indexed_at: string;
  release_at: string | null;
};

/** Row shape from GET /api/dashboard/posts (`SELECT * FROM creator_posts`). */
export type DashboardPost = {
  id: number;
  title: string | null;
  body: string;
  visibility: 'public' | 'supporters_only';
  published_at: string;
  notify_supporters: number;
  release_notified_at: string | null;
  created_at: string;
  updated_at: string;
};

export type BroadcastQueueItem = { id: number; title: string; artist: string | null };

export type LiveState = {
  isLive: boolean;
  source: 'mic' | 'rtmp' | null;
  startedAt: string | null;
  rtmpPending: boolean;
  rtmpPort: number | null;
};

/** GET /api/schedule/current — the currently-resolved dayparting block, or null when none is active. */
export type ScheduleBlock = {
  id: number;
  day_of_week: number | null;
  start_time: string;
  end_time: string;
  category: string | null;
  tags_filter: string | null;
  mode: 'shuffle' | 'sequential' | 'smart_playlist';
};

export type AnalyticsLive = { currentListeners: number; peakToday: number };
export type AnalyticsHistoryRow = {
  date: string;
  unique_listeners: number;
  total_listen_sec: number;
  top_media_id: number | null;
};
export type AnalyticsActivityEntry = {
  type: 'tip' | 'unlock' | 'subscription';
  title: string;
  detail: string;
  occurred_at: string;
};
export type EarningsBreakdown = {
  unlockType: string;
  targetId: number;
  title: string;
  unitsSold: number;
  revenueCents: number;
};
export type Earnings = {
  unlocks: EarningsBreakdown[];
  todayUnlocks: EarningsBreakdown[];
  [key: string]: unknown;
};

export type NotifyLogEvent = {
  id: number;
  context: string;
  content: string;
  status: 'sent' | 'failed' | 'skipped';
  error_msg: string | null;
  created_at: string;
};

export type UploadMediaInput = {
  uri: string;
  name: string;
  mimeType?: string | null;
  category: 'music' | 'video' | 'podcast' | 'other';
  visibility: 'public' | 'supporters_only' | 'vault';
  title?: string;
  artist?: string;
  album?: string;
  onProgress?: (progress: UploadProgress) => void;
};

export type UploadMediaResult = {
  id: number | null;
  filename: string;
  filepath?: string;
  size?: number;
  category: string;
  visibility: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  error?: string;
};

/**
 * Unauthenticated — POST /api/auth/dashboard/device/redeem, used only
 * during pairing before a device token exists. `baseUrl` is the origin
 * parsed from the scanned QR's pairUrl.
 */
export async function redeemPairToken(
  baseUrl: string,
  pairToken: string
): Promise<{ ok?: boolean; token?: string; error?: string }> {
  const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/auth/dashboard/device/redeem`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pairToken }),
  });
  const data = (await safeJson(res)) as { ok?: boolean; token?: string; error?: string };
  if (!res.ok || !data.token) throw new DashboardClientError(res.status, data);
  return data;
}

export class DashboardClient {
  constructor(
    private baseUrl: string,
    private token: string,
    private onUnauthorized?: () => void
  ) {}

  private url(path: string): string {
    return `${this.baseUrl.replace(/\/+$/, '')}${path}`;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return { Accept: 'application/json', Authorization: `Bearer ${this.token}`, ...extra };
  }

  async get<T>(path: string): Promise<T> {
    const res = await fetch(this.url(path), { headers: this.headers() });
    if (!res.ok) {
      if (res.status === 401) this.onUnauthorized?.();
      throw new DashboardClientError(res.status, await safeJson(res));
    }
    return res.json();
  }

  private async send<T>(method: string, path: string, body?: unknown): Promise<{ res: Response; data: T }> {
    const res = await fetch(this.url(path), {
      method,
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) this.onUnauthorized?.();
    const data = (await safeJson(res)) as T;
    return { res, data };
  }

  post<T>(path: string, body?: unknown) {
    return this.send<T>('POST', path, body);
  }

  patch<T>(path: string, body: unknown) {
    return this.send<T>('PATCH', path, body);
  }

  put<T>(path: string, body: unknown) {
    return this.send<T>('PUT', path, body);
  }

  del<T>(path: string) {
    return this.send<T>('DELETE', path);
  }

  /** GET /api/stream/status — now-playing/live display (public, but scoped to the paired station). */
  streamStatus(): Promise<StreamStatus> {
    return this.get('/api/stream/status');
  }

  /** GET /api/dashboard/live/status — mic-live session state. */
  liveStatus(): Promise<LiveState> {
    return this.get('/api/dashboard/live/status');
  }

  /** GET /api/schedule/current — the currently-resolved dayparting block, or null. */
  scheduleCurrent(): Promise<ScheduleBlock | null> {
    return this.get('/api/schedule/current');
  }

  /** GET /api/dashboard/broadcast/queue — the station's up-next manual queue (max 5). */
  broadcastQueue(): Promise<{ queue: BroadcastQueueItem[] }> {
    return this.get('/api/dashboard/broadcast/queue');
  }

  /** POST /api/dashboard/broadcast/queue — add a track to the up-next queue. */
  async queueTrack(mediaId: number): Promise<{ ok: boolean; queueLength?: number; error?: string }> {
    const { data } = await this.post<{ ok: boolean; queueLength?: number; error?: string }>(
      '/api/dashboard/broadcast/queue',
      { mediaId }
    );
    return data;
  }

  /** DELETE /api/dashboard/broadcast/queue/:idx — remove a queued track by its position. */
  async dequeueTrack(idx: number): Promise<void> {
    await this.del(`/api/dashboard/broadcast/queue/${idx}`);
  }

  /** POST /api/dashboard/broadcast/restart — stop then restart the station's broadcast engine. */
  async broadcastRestart(): Promise<{ ok: boolean; restarting?: boolean }> {
    const { data } = await this.post<{ ok: boolean; restarting?: boolean }>('/api/dashboard/broadcast/restart');
    return data;
  }

  /** POST /api/dashboard/broadcast/stop — stop the station's broadcast engine. */
  async broadcastStop(): Promise<{ ok: boolean; stopped?: boolean }> {
    const { data } = await this.post<{ ok: boolean; stopped?: boolean }>('/api/dashboard/broadcast/stop');
    return data;
  }

  /** POST /api/dashboard/broadcast/mode — switch between 'shuffle' and 'scheduled'. */
  async broadcastMode(mode: 'shuffle' | 'scheduled'): Promise<{ ok: boolean; mode?: string; error?: string }> {
    const { data } = await this.post<{ ok: boolean; mode?: string; error?: string }>(
      '/api/dashboard/broadcast/mode',
      { mode }
    );
    return data;
  }

  /** GET /api/dashboard/media — every active media item (creator sees everything, incl. vault). Also the queue-picker's data source. */
  mediaList(): Promise<DashboardMediaItem[]> {
    return this.get('/api/dashboard/media');
  }

  /** PATCH /api/dashboard/media/:id — used here for release_at scheduling only (null cancels). */
  mediaUpdate(id: number, body: { release_at: string | null }) {
    return this.patch<DashboardMediaItem & { error?: string }>(`/api/dashboard/media/${id}`, body);
  }

  /** GET /api/dashboard/posts — every creator post, most recently published first. */
  postsList(): Promise<DashboardPost[]> {
    return this.get('/api/dashboard/posts');
  }

  /** PUT /api/dashboard/posts/:id — used here for publishedAt scheduling only. */
  postUpdate(id: number, body: { publishedAt: string | null }) {
    return this.put<DashboardPost & { error?: string }>(`/api/dashboard/posts/${id}`, body);
  }

  /** GET /api/analytics/live — current + today's peak listener count. */
  analyticsLive(): Promise<AnalyticsLive> {
    return this.get('/api/analytics/live');
  }

  /** GET /api/analytics/history?days= — daily listener/listen-time history. */
  analyticsHistory(days = 30): Promise<AnalyticsHistoryRow[]> {
    return this.get(`/api/analytics/history?days=${days}`);
  }

  /** GET /api/analytics/activity?limit= — merged recent tips/unlocks/subscriptions feed. */
  analyticsActivity(limit = 10): Promise<AnalyticsActivityEntry[]> {
    return this.get(`/api/analytics/activity?limit=${limit}`);
  }

  /** GET /api/dashboard/earnings — revenue summary across vault unlocks/tips/subscriptions. */
  earnings(): Promise<Earnings> {
    return this.get('/api/dashboard/earnings');
  }

  /** GET /api/dashboard/notify-log?limit= — recent outbound notify-webhook fires (go-live/post/media-release). */
  notifyLog(limit = 50): Promise<{ events: NotifyLogEvent[] }> {
    return this.get(`/api/dashboard/notify-log?limit=${limit}`);
  }

  /** POST /api/dashboard/upload — multipart media upload into the station vault. */
  async uploadMedia(input: UploadMediaInput): Promise<UploadMediaResult> {
    const file = new File(input.uri);
    const result = await file.upload(this.url('/api/dashboard/upload'), {
      httpMethod: 'POST',
      uploadType: UploadType.MULTIPART,
      fieldName: 'media',
      mimeType: input.mimeType || 'application/octet-stream',
      headers: this.headers(),
      parameters: {
        category: input.category,
        visibility: input.visibility,
        title: input.title?.trim() || '',
        artist: input.artist?.trim() || '',
        album: input.album?.trim() || '',
      },
      sessionType: 'foreground',
      onProgress: input.onProgress,
    });
    const data = result.body ? (JSON.parse(result.body) as UploadMediaResult) : ({} as UploadMediaResult);
    if (result.status === 401) this.onUnauthorized?.();
    if (result.status < 200 || result.status >= 300) {
      throw new DashboardClientError(result.status, data);
    }
    return data;
  }
}

export function createDashboardClient(baseUrl: string, token: string, onUnauthorized?: () => void): DashboardClient {
  return new DashboardClient(baseUrl, token, onUnauthorized);
}
