import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { createDashboardClient, type DashboardClient } from '@/api/dashboardClient';

// The Studio tab's paired-device identity is deliberately separate from
// stationStore's listener identity: pairing authenticates a
// requireDashboard-gated *creator* session (Phase 0's bearer flow), a
// different scope/token than a listener's pw_token bearer. Persisted in
// expo-secure-store (Keychain/Keystore-backed), not AsyncStorage — this is a
// long-lived credential equivalent to the desktop's pw_dashboard_session
// cookie, per the Phase 5 plan's explicit instruction.

export type StudioIdentity = {
  baseUrl: string;
  deviceToken: string;
  deviceLabel: string;
  pairedAt: string;
};

const SECURE_KEY = 'paperweight.studioStore.v1';

type StudioStoreValue = {
  hydrated: boolean;
  studio: StudioIdentity | null;
  setStudio: (identity: StudioIdentity) => void;
  signOut: () => void;
};

const StudioStoreContext = createContext<StudioStoreValue | null>(null);

export function StudioStoreProvider({ children }: { children: ReactNode }) {
  const [studio, setStudioState] = useState<StudioIdentity | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    SecureStore.getItemAsync(SECURE_KEY)
      .then((raw) => {
        if (cancelled || !raw) return;
        try {
          setStudioState(JSON.parse(raw) as StudioIdentity);
        } catch {
          // Corrupt storage — fall back to unpaired rather than crash.
        }
      })
      .finally(() => {
        if (!cancelled) setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setStudio = useCallback((identity: StudioIdentity) => {
    setStudioState(identity);
    SecureStore.setItemAsync(SECURE_KEY, JSON.stringify(identity)).catch(() => {});
  }, []);

  const signOut = useCallback(() => {
    setStudioState(null);
    SecureStore.deleteItemAsync(SECURE_KEY).catch(() => {});
  }, []);

  const value = useMemo<StudioStoreValue>(
    () => ({ hydrated, studio, setStudio, signOut }),
    [hydrated, studio, setStudio, signOut]
  );

  return <StudioStoreContext.Provider value={value}>{children}</StudioStoreContext.Provider>;
}

export function useStudioStore(): StudioStoreValue {
  const ctx = useContext(StudioStoreContext);
  if (!ctx) throw new Error('useStudioStore must be used within a StudioStoreProvider');
  return ctx;
}

/** Memoized DashboardClient bound to the current paired device — null while unpaired. */
export function useDashboardClient(): DashboardClient | null {
  const { studio } = useStudioStore();
  return useMemo(
    () => (studio ? createDashboardClient(studio.baseUrl, studio.deviceToken) : null),
    [studio]
  );
}
