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

type Ok<T = object> = { ok: true } & T;
type Err = { ok: false; error: string };

type ListenerAuthValue = {
  state: ListenerAuthState;
  ready: boolean;
  refresh: () => Promise<void>;
  login: (email: string, password: string) => Promise<Ok | Err>;
  register: (email: string, password: string, opts?: { displayName?: string; marketingOptIn?: boolean }) => Promise<Ok | Err>;
  logout: () => Promise<void>;
  setPassword: (password: string) => Promise<Ok | Err>;
  requestPasswordReset: (email: string) => Promise<Ok<{ emailEnabled: boolean }> | Err>;
  resetPassword: (token: string, password: string) => Promise<Ok | Err>;
  verifyEmail: (token: string) => Promise<Ok | Err>;
  autoLogin: (token: string) => Promise<Ok | Err>;
  resendVerification: () => Promise<Ok<{ emailEnabled: boolean }> | Err>;
  updatePreferences: (prefs: { marketingOptIn: boolean }) => Promise<Ok | Err>;
  settingsTourSeen: () => Promise<void>;
  deleteProfile: () => Promise<Ok | Err>;
  deleteAccount: (body: { password?: string; confirmEmail?: string }) => Promise<Ok<{ warnings?: string[] }> | Err>;
  cancelSubscription: () => Promise<Ok<{ effectiveUntil?: string }> | Err>;
  billingPortal: () => Promise<Ok<{ url: string }> | Err>;
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

  const setPassword = useCallback(async (password: string) => {
    const { res, data } = await api.auth.setPassword(password);
    if (!res.ok) return { ok: false as const, error: data.error || 'Failed to set password.' };
    await refresh();
    return { ok: true as const };
  }, [refresh]);

  const requestPasswordReset = useCallback(async (email: string) => {
    try {
      const { data } = await api.auth.requestPasswordReset(email);
      return { ok: true as const, emailEnabled: !!data.emailEnabled };
    } catch {
      return { ok: false as const, error: 'Network error — please try again.' };
    }
  }, []);

  const resetPassword = useCallback(async (token: string, password: string) => {
    const { res, data } = await api.auth.resetPassword(token, password);
    if (!res.ok) return { ok: false as const, error: data.error || 'Reset failed.' };
    return { ok: true as const };
  }, []);

  const verifyEmail = useCallback(async (token: string) => {
    const { res, data } = await api.auth.verifyEmail(token);
    if (!res.ok) return { ok: false as const, error: data.error || 'This link is invalid or has expired.' };
    await refresh();
    return { ok: true as const };
  }, [refresh]);

  const autoLogin = useCallback(async (token: string) => {
    const { res, data } = await api.auth.autoLogin(token);
    if (!res.ok) return { ok: false as const, error: data.error || 'This link is invalid or has expired.' };
    await refresh();
    return { ok: true as const };
  }, [refresh]);

  const resendVerification = useCallback(async () => {
    try {
      const { data } = await api.auth.resendVerification();
      return { ok: true as const, emailEnabled: !!data.emailEnabled };
    } catch {
      return { ok: false as const, error: 'Network error — please try again.' };
    }
  }, []);

  const updatePreferences = useCallback(async (prefs: { marketingOptIn: boolean }) => {
    const { res, data } = await api.auth.updatePreferences(prefs);
    if (!res.ok) return { ok: false as const, error: data.error || 'Failed to update preferences.' };
    setState((prev) => ({ ...prev, marketingOptIn: prefs.marketingOptIn }));
    return { ok: true as const };
  }, []);

  const settingsTourSeen = useCallback(async () => {
    try { await api.auth.settingsTourSeen(); } catch { /* best-effort */ }
  }, []);

  const deleteProfile = useCallback(async () => {
    const { res, data } = await api.auth.deleteProfile();
    if (!res.ok) return { ok: false as const, error: data.error || 'Deletion failed.' };
    setState(ANONYMOUS_STATE);
    return { ok: true as const };
  }, []);

  const deleteAccount = useCallback(async (body: { password?: string; confirmEmail?: string }) => {
    const { res, data } = await api.auth.deleteAccount(body);
    if (!res.ok) return { ok: false as const, error: data.error || 'Deletion failed.' };
    setState(ANONYMOUS_STATE);
    return { ok: true as const, warnings: data.warnings };
  }, []);

  const cancelSubscription = useCallback(async () => {
    const { res, data } = await api.payment.cancelSubscription();
    if (!res.ok) return { ok: false as const, error: data.error || 'Cancellation failed.' };
    setState((prev) => ({ ...prev, subscriptionStatus: 'canceled' }));
    return { ok: true as const, effectiveUntil: data.effectiveUntil };
  }, []);

  const billingPortal = useCallback(async () => {
    const { res, data } = await api.payment.billingPortal();
    if (!res.ok || !data.url) return { ok: false as const, error: data.error || 'Could not open the billing portal.' };
    return { ok: true as const, url: data.url as string };
  }, []);

  const value = useMemo<ListenerAuthValue>(() => ({
    state, ready, refresh, login, register, logout,
    setPassword, requestPasswordReset, resetPassword, verifyEmail, autoLogin,
    resendVerification, updatePreferences, settingsTourSeen, deleteProfile,
    deleteAccount, cancelSubscription, billingPortal,
  }), [state, ready, refresh, login, register, logout, setPassword, requestPasswordReset,
    resetPassword, verifyEmail, autoLogin, resendVerification, updatePreferences,
    settingsTourSeen, deleteProfile, deleteAccount, cancelSubscription, billingPortal]);

  return <ListenerAuthContext.Provider value={value}>{children}</ListenerAuthContext.Provider>;
}

export function useListenerAuth() {
  const ctx = useContext(ListenerAuthContext);
  if (!ctx) throw new Error('useListenerAuth must be used within ListenerAuthProvider');
  return ctx;
}
