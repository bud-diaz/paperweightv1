import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import * as api from '@/lib/api';

type Status = 'checking' | 'anonymous' | 'needs2fa' | 'authenticated';

type DashboardAuthValue = {
  status: Status;
  /** True once the initial session probe (api.dashboard.check()) has resolved. */
  ready: boolean;
  login: (token: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  verify2fa: (code: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  cancel2fa: () => void;
  logout: () => Promise<void>;
};

const DashboardAuthContext = createContext<DashboardAuthValue | null>(null);

export function DashboardAuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('checking');
  const [challenge, setChallenge] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.dashboard.check().then((ok: boolean) => {
      if (!cancelled) setStatus(ok ? 'authenticated' : 'anonymous');
    }).catch(() => {
      if (!cancelled) setStatus('anonymous');
    });
    return () => { cancelled = true; };
  }, []);

  const login = useCallback(async (token: string) => {
    const { res, data } = await api.auth.dashboardLogin(token);
    if (!res.ok) return { ok: false as const, error: data.error || 'Invalid token' };
    if (data.requires2FA && data.challenge) {
      setChallenge(data.challenge);
      setStatus('needs2fa');
      return { ok: true as const };
    }
    setStatus('authenticated');
    return { ok: true as const };
  }, []);

  const verify2fa = useCallback(async (code: string) => {
    if (!challenge) return { ok: false as const, error: 'Start login again' };
    const { res, data } = await api.auth.dashboardVerify2fa(challenge, code);
    if (!res.ok) return { ok: false as const, error: data.error || 'Invalid code' };
    setChallenge(null);
    setStatus('authenticated');
    return { ok: true as const };
  }, [challenge]);

  const cancel2fa = useCallback(() => {
    setChallenge(null);
    setStatus('anonymous');
  }, []);

  const logout = useCallback(async () => {
    await api.auth.dashboardLogout();
    setChallenge(null);
    setStatus('anonymous');
  }, []);

  const value = useMemo<DashboardAuthValue>(() => ({
    status,
    ready: status !== 'checking',
    login,
    verify2fa,
    cancel2fa,
    logout,
  }), [status, login, verify2fa, cancel2fa, logout]);

  return <DashboardAuthContext.Provider value={value}>{children}</DashboardAuthContext.Provider>;
}

export function useDashboardAuth() {
  const ctx = useContext(DashboardAuthContext);
  if (!ctx) throw new Error('useDashboardAuth must be used within DashboardAuthProvider');
  return ctx;
}
