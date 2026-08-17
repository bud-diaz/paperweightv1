import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { createStationClient, type StationClient } from '@/api/stationClient';

export type StationIdentity = {
  publicUrl: string;
  slug: string;
  name: string;
};

export type ListenerAuth = {
  token: string;
  tier: string;
};

type PersistedState = {
  station: StationIdentity | null;
  manualBaseUrl: string | null;
  /** Keyed by effective base URL — a listener's login is per-station, not global. */
  authByStation: Record<string, ListenerAuth>;
};

const STORAGE_KEY = 'paperweight.stationStore.v1';

const emptyState: PersistedState = { station: null, manualBaseUrl: null, authByStation: {} };

type StationStoreValue = {
  /** False until AsyncStorage has been read once — avoid rendering stale/default UI before this flips. */
  hydrated: boolean;
  station: StationIdentity | null;
  manualBaseUrl: string | null;
  /** manualBaseUrl wins when set — this is what every downstream screen/client should read, never a captured closure. */
  baseUrl: string | null;
  listenerAuth: ListenerAuth | null;
  setStation: (station: StationIdentity) => void;
  clearStation: () => void;
  setManualBaseUrl: (url: string | null) => void;
  setListenerAuth: (auth: ListenerAuth | null) => void;
};

const StationStoreContext = createContext<StationStoreValue | null>(null);

export function StationStoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PersistedState>(emptyState);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (cancelled) return;
        if (raw) {
          try {
            setState({ ...emptyState, ...JSON.parse(raw) });
          } catch {
            // Corrupt storage — fall back to empty state rather than crash the app.
          }
        }
      })
      .finally(() => {
        if (!cancelled) setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // Skip the pre-hydration render so we never overwrite storage with emptyState on cold start.
    if (!hydrated) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => {});
  }, [state, hydrated]);

  const baseUrl = state.manualBaseUrl || state.station?.publicUrl || null;

  const setStation = useCallback((station: StationIdentity) => {
    setState((prev) => ({ ...prev, station }));
  }, []);

  const clearStation = useCallback(() => {
    setState((prev) => ({ ...prev, station: null }));
  }, []);

  const setManualBaseUrl = useCallback((url: string | null) => {
    setState((prev) => ({ ...prev, manualBaseUrl: url ? url.trim() : null }));
  }, []);

  const setListenerAuth = useCallback(
    (auth: ListenerAuth | null) => {
      setState((prev) => {
        const key = prev.manualBaseUrl || prev.station?.publicUrl || null;
        if (!key) return prev;
        const authByStation = { ...prev.authByStation };
        if (auth) authByStation[key] = auth;
        else delete authByStation[key];
        return { ...prev, authByStation };
      });
    },
    []
  );

  const listenerAuth = baseUrl ? (state.authByStation[baseUrl] ?? null) : null;

  const value = useMemo<StationStoreValue>(
    () => ({
      hydrated,
      station: state.station,
      manualBaseUrl: state.manualBaseUrl,
      baseUrl,
      listenerAuth,
      setStation,
      clearStation,
      setManualBaseUrl,
      setListenerAuth,
    }),
    [hydrated, state, baseUrl, listenerAuth, setStation, clearStation, setManualBaseUrl, setListenerAuth]
  );

  return <StationStoreContext.Provider value={value}>{children}</StationStoreContext.Provider>;
}

export function useStationStore(): StationStoreValue {
  const ctx = useContext(StationStoreContext);
  if (!ctx) throw new Error('useStationStore must be used within a StationStoreProvider');
  return ctx;
}

/** Memoized StationClient bound to the current effective baseUrl + listener token — never a stale closure. */
export function useStationClient(): StationClient | null {
  const { baseUrl, listenerAuth } = useStationStore();
  return useMemo(() => (baseUrl ? createStationClient(baseUrl, listenerAuth?.token) : null), [baseUrl, listenerAuth]);
}
