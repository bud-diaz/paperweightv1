/**
 * Fetch wrapper parameterized by a station's base URL (its `publicUrl` from
 * System.Pape, or a manually-entered override — see stationStore). The RN
 * analog of studio/src/lib/api.js's _fetch/_json/_send helpers, but without
 * that file's same-origin-cookie assumption: mobile has no shared origin
 * with any station, so every authenticated call attaches
 * `Authorization: Bearer <token>` explicitly instead of relying on cookies.
 */

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
  me(): Promise<{ email?: string; displayName?: string; hasAccount: boolean; hasPassword: boolean }> {
    return this.get('/api/listener/me');
  }
}

export function createStationClient(baseUrl: string, token?: string | null): StationClient {
  return new StationClient(baseUrl, token);
}
