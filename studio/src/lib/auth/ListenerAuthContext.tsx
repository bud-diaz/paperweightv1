import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import * as api from '@/lib/api';

export type Tier = 'free' | 'subscriber' | 'pro' | 'all_access';

export type ListenerAuthState = {
  loggedIn: boolean;
  email: string;
  displayName: string;
  tier: Tier;
  hasPassword: boolean;
  hasAccount: boolean;
  subscriptionStatus: string | null;
  provider: string | null;
  emailVerified: boolean;
  settingsTourSeenAt: string | null;
  marketingOptIn: boolean;
};

const ANONYMOUS_STATE: ListenerAuthState = {
  loggedIn: false, email: '', displayName: '', tier: 'free', hasPassword: false,
  hasAccount: false, subscriptionStatus: null, provider: null, emailVerified: false,
  settingsTourSeenAt: null, marketingOptIn: false,
};

type ListenerAuthValue = {
  state: ListenerAuthState;
  ready: boolean;
  refresh: () => Promise<void>;
  login: (email: string, password: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  register: (email: string, password: string, opts?: { displayName?: string; marketingOptIn?: boolean }) => Promise<{ ok: true } | { ok: false; error: string }>;
  logout: () => Promise<void>;
};

const ListenerAuthContext = createContext<ListenerAuthValue | null>(null);

// Mirrors client/js/auth.js's loadAuthState() exactly: api.auth.me() always
// resolves with a tier (even anonymously); api.auth.listenerMe() answers for
// real accounts and welcome-page profiles, but rejects for a creator-issued
// token with no listener account attached, so both layers of fallback here
// are load-bearing, not defensive dead code.
async function loadListenerState(): Promise<ListenerAuthState> {
  let me: { tier: Tier };
  try {
    me = await api.auth.me();
  } catch {
    return ANONYMOUS_STATE;
  }
  try {
    const acc = await api.auth.listenerMe();
    if (!acc || acc.error) throw new Error(acc?.error || 'Not authenticated');
    return {
      loggedIn: true,
      email: acc.email || '',
      displayName: acc.displayName || '',
      tier: me.tier,
      hasPassword: !!acc.hasPassword,
      hasAccount: acc.hasAccount !== false,
      subscriptionStatus: acc.subscriptionStatus || null,
      provider: acc.provider || null,
      emailVerified: !!acc.emailVerified,
      settingsTourSeenAt: acc.settingsTourSeenAt || null,
      marketingOptIn: !!acc.marketingOptIn,
    };
  } catch {
    if (me.tier === 'free') return ANONYMOUS_STATE;
    // Creator-issued token: valid non-free tier but no listener account.
    return { ...ANONYMOUS_STATE, loggedIn: true, tier: me.tier, hasPassword: true };
  }
}

export function ListenerAuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ListenerAuthState>(ANONYMOUS_STATE);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    const next = await loadListenerState();
    setState(next);
    setReady(true);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const { res, data } = await api.auth.login(email, password);
    if (!res.ok) return { ok: false as const, error: data.error || 'Something went wrong.' };
    await refresh();
    return { ok: true as const };
  }, [refresh]);

  const register = useCallback(async (email: string, password: string, opts?: { displayName?: string; marketingOptIn?: boolean }) => {
    const { res, data } = await api.auth.register(email, password, opts);
    if (!res.ok) return { ok: false as const, error: data.error || 'Something went wrong.' };
    await refresh();
    return { ok: true as const };
  }, [refresh]);

  const logout = useCallback(async () => {
    try { await api.auth.logout(); } catch { /* clear local state regardless */ }
    setState(ANONYMOUS_STATE);
  }, []);

  const value = useMemo<ListenerAuthValue>(() => ({ state, ready, refresh, login, register, logout }), [state, ready, refresh, login, register, logout]);

  return <ListenerAuthContext.Provider value={value}>{children}</ListenerAuthContext.Provider>;
}

export function useListenerAuth() {
  const ctx = useContext(ListenerAuthContext);
  if (!ctx) throw new Error('useListenerAuth must be used within ListenerAuthProvider');
  return ctx;
}
