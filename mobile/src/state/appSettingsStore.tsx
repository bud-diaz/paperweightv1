import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type ThemeMode = 'system' | 'light' | 'dark';

type AppSettingsState = {
  themeMode: ThemeMode;
};

type AppSettingsValue = AppSettingsState & {
  hydrated: boolean;
  setThemeMode: (themeMode: ThemeMode) => void;
};

const STORAGE_KEY = 'paperweight.appSettings.v1';
const defaultState: AppSettingsState = { themeMode: 'system' };
const AppSettingsContext = createContext<AppSettingsValue | null>(null);

function normalizeThemeMode(value: unknown): ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
}

export function AppSettingsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppSettingsState>(defaultState);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (cancelled || !raw) return;
        try {
          const parsed = JSON.parse(raw) as Partial<AppSettingsState>;
          setState({ themeMode: normalizeThemeMode(parsed.themeMode) });
        } catch {
          // Corrupt settings should never block app boot.
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
    if (!hydrated) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => {});
  }, [hydrated, state]);

  const setThemeMode = useCallback((themeMode: ThemeMode) => {
    setState((prev) => ({ ...prev, themeMode }));
  }, []);

  const value = useMemo<AppSettingsValue>(
    () => ({ hydrated, themeMode: state.themeMode, setThemeMode }),
    [hydrated, state.themeMode, setThemeMode]
  );

  return <AppSettingsContext.Provider value={value}>{children}</AppSettingsContext.Provider>;
}

export function useAppSettings(): AppSettingsValue {
  const ctx = useContext(AppSettingsContext);
  if (!ctx) throw new Error('useAppSettings must be used within an AppSettingsProvider');
  return ctx;
}

export function useOptionalAppSettings(): AppSettingsValue | null {
  return useContext(AppSettingsContext);
}
