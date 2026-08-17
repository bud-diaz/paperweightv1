/**
 * Bearer-attaching client for requireDashboard-gated routes (Phase 0's
 * device-pairing bearer flow), parameterized by the paired station's base
 * URL. Separate from stationClient.ts on purpose — this authenticates a
 * creator/dashboard session, a different scope than a listener's pw_token.
 */

export type BroadcastQueueItem = { mediaId: number; title?: string };
export type BroadcastMode = 'shuffle' | 'scheduled';

export type EarningsTotals = {
  revenueCents: number;
  monthRevenueCents: number;
  todayRevenueCents: number;
  unitsSold: number;
  activeSubscriptions: number;
  knownMonthlyRecurringCents: number;
};

export type HistoryDay = { date: string; unique_listeners: number; total_listen_sec: number; top_media_id: number | null };
export type ActivityItem = { type: 'tip' | 'unlock' | 'subscription'; title: string; detail: string; occurred_at: string };

export type DashboardSettings = {
  notifyWebhookUrl: string;
  notifyLiveEnabled: boolean;
  feedEnabled: boolean;
  feedScope: string;
  trackGlowColor: string;
  emailConfigured: boolean;
};

export type DashboardMediaItem = {
  id: number;
  title: string | null;
  filename: string;
  category: string | null;
  visibility: 'public' | 'supporters_only' | 'vault';
  duration: number | null;
  artist: string | null;
  release_at: string | null;
};

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

export class DashboardClient {
  constructor(
    private baseUrl: string,
    private deviceToken: string
  ) {}

  private url(path: string): string {
    return `${this.baseUrl.replace(/\/+$/, '')}${path}`;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return { Accept: 'application/json', Authorization: `Bearer ${this.deviceToken}`, ...extra };
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(this.url(path), { headers: this.headers() });
    if (!res.ok) throw new DashboardClientError(res.status, await safeJson(res));
    return res.json();
  }

  private async send<T>(path: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown): Promise<T> {
    const res = await fetch(this.url(path), {
      method,
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new DashboardClientError(res.status, await safeJson(res));
    return safeJson(res) as Promise<T>;
  }

  /** GET /api/dashboard/broadcast/queue */
  broadcastQueue(): Promise<{ queue: BroadcastQueueItem[] }> {
    return this.get('/api/dashboard/broadcast/queue');
  }

  /** POST /api/dashboard/broadcast/mode */
  setBroadcastMode(mode: BroadcastMode): Promise<unknown> {
    return this.send('/api/dashboard/broadcast/mode', 'POST', { mode });
  }

  /** POST /api/dashboard/broadcast/restart */
  restartBroadcast(): Promise<unknown> {
    return this.send('/api/dashboard/broadcast/restart', 'POST');
  }

  /** DELETE /api/dashboard/broadcast/queue/:idx */
  removeFromQueue(idx: number): Promise<unknown> {
    return this.send(`/api/dashboard/broadcast/queue/${idx}`, 'DELETE');
  }

  /** GET /api/dashboard/earnings — full response is large; only `totals` is surfaced here. */
  async earnings(): Promise<EarningsTotals> {
    const data = await this.get<{ totals: EarningsTotals }>('/api/dashboard/earnings');
    return data.totals;
  }

  /** GET /api/analytics/history?days= */
  analyticsHistory(days: number): Promise<HistoryDay[]> {
    return this.get(`/api/analytics/history?days=${days}`);
  }

  /** GET /api/analytics/activity?limit= */
  analyticsActivity(limit: number): Promise<ActivityItem[]> {
    return this.get(`/api/analytics/activity?limit=${limit}`);
  }

  /** GET /api/dashboard/settings */
  getSettings(): Promise<DashboardSettings> {
    return this.get('/api/dashboard/settings');
  }

  /** PUT /api/dashboard/settings — partial update, only the given keys are touched server-side. */
  updateSettings(body: { notifyWebhookUrl?: string; notifyLiveEnabled?: boolean }): Promise<unknown> {
    return this.send('/api/dashboard/settings', 'PUT', body);
  }

  /** GET /api/dashboard/media — full catalog including vault, creator-scoped. */
  mediaList(): Promise<DashboardMediaItem[]> {
    return this.get('/api/dashboard/media');
  }

  /** PATCH /api/dashboard/media/:id — release_at: ISO datetime to schedule, or null to cancel. */
  updateMediaReleaseAt(id: number, releaseAt: string | null): Promise<unknown> {
    return this.send(`/api/dashboard/media/${id}`, 'PATCH', { release_at: releaseAt });
  }
}

export function createDashboardClient(baseUrl: string, deviceToken: string): DashboardClient {
  return new DashboardClient(baseUrl, deviceToken);
}

/**
 * POST /api/auth/dashboard/device/redeem — consumes a pairing token from a
 * scanned QR (Phase 0's bearer flow). Unauthenticated by design (this is how
 * a new device gets in), so it's a bare function rather than a
 * DashboardClient method — there's no device token yet to attach.
 */
export async function redeemDevicePairing(
  baseUrl: string,
  pairToken: string
): Promise<{ ok?: boolean; token?: string; error?: string }> {
  const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/auth/dashboard/device/redeem`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ pairToken }),
  });
  return (await safeJson(res)) as { ok?: boolean; token?: string; error?: string };
}
