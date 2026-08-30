/**
 * Persists the phone's Studio *pairing* identity — which station's desktop
 * dashboard this device is paired to, and its long-lived device bearer
 * token. Deliberately separate from stationStore's "listening station":
 * a creator can be tuned to (and listening to) a different station on
 * Discover/Play/Stack while Studio stays paired to their own station, per
 * the scope doc ("Studio only ever controls the one station the phone is
 * paired to"). Backed by expo-secure-store (Keychain/Keystore), not
 * AsyncStorage — this is a long-lived credential, unlike the listener auth
 * in stationStore.
 */

import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { createDashboardClient, type DashboardClient } from '@/api/dashboardClient';

export type DashboardAuth = {
  baseUrl: string;
  token: string;
  label: string;
  pairedAt: string;
};

const STORAGE_KEY = 'paperweight.dashboardAuth.v1';

type DashboardAuthValue = {
  /** False until secure-store has been read once — avoid rendering the unpaired gate before this flips. */
  hydrated: boolean;
  auth: DashboardAuth | null;
  isPaired: boolean;
  pair: (baseUrl: string, token: string, label: string) => Promise<void>;
  /** Clears the local credential only — no remote revoke call. Full device revocation stays on web Security.tsx. */
  signOut: () => Promise<void>;
};

const DashboardAuthContext = createContext<DashboardAuthValue | null>(null);

export function DashboardAuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<DashboardAuth | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    SecureStore.getItemAsync(STORAGE_KEY)
      .then((raw) => {
        if (cancelled || !raw) return;
        try {
          setAuth(JSON.parse(raw));
        } catch {
          // Corrupt storage — fall back to unpaired rather than crash the app.
        }
      })
      .finally(() => {
        if (!cancelled) setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const pair = useCallback(async (baseUrl: string, token: string, label: string) => {
    const next: DashboardAuth = { baseUrl, token, label, pairedAt: new Date().toISOString() };
    setAuth(next);
    await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(next));
  }, []);

  const signOut = useCallback(async () => {
    setAuth(null);
    await SecureStore.deleteItemAsync(STORAGE_KEY);
  }, []);

  const value = useMemo<DashboardAuthValue>(
    () => ({ hydrated, auth, isPaired: auth !== null, pair, signOut }),
    [hydrated, auth, pair, signOut]
  );

  return <DashboardAuthContext.Provider value={value}>{children}</DashboardAuthContext.Provider>;
}

export function useDashboardAuth(): DashboardAuthValue {
  const ctx = useContext(DashboardAuthContext);
  if (!ctx) throw new Error('useDashboardAuth must be used within a DashboardAuthProvider');
  return ctx;
}

/**
 * Memoized DashboardClient bound to the paired station + device token, null
 * until paired. A 401 (device revoked from web Security.tsx mid-session)
 * clears the local credential automatically so the UI falls back cleanly to
 * StudioGate instead of error-looping.
 */
export function useDashboardClient(): DashboardClient | null {
  const { auth, signOut } = useDashboardAuth();
  return useMemo(() => {
    if (!auth) return null;
    return createDashboardClient(auth.baseUrl, auth.token, () => {
      signOut();
    });
  }, [auth, signOut]);
}
