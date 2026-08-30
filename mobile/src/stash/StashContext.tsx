import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

import { usePlayerEngine } from '@/player/PlayerEngineContext';
import { useStationClient, useStationStore } from '@/state/stationStore';
import { useStashStoreState, type StashStore } from '@/stash/stashStore';

/**
 * Shares one Stash instance across the app — StickyTransportBar's stash
 * toggle and StackScreen's Stash segment both need the same store. Mounted
 * once in src/app/_layout.tsx, nested inside PlayerEngineProvider (Stash
 * playback calls engine.pause() before starting, per the "separate player
 * from the main PlayerEngine" design in the plan).
 */

type StashContextValue = StashStore & {
  notification: string | null;
  dismissNotification: () => void;
  /** Calls engine.pause() before starting local playback — Stash and the live/on-demand engine are intentionally separate players. */
  playWithPause: (key: string) => Promise<boolean>;
};

const StashContext = createContext<StashContextValue | null>(null);

export function StashProvider({ children }: { children: ReactNode }) {
  const stationClient = useStationClient();
  const { station, baseUrl, listenerAuth } = useStationStore();
  const engine = usePlayerEngine();
  const [notification, setNotification] = useState<string | null>(null);

  const stash = useStashStoreState({
    stationClient,
    station: baseUrl ? { baseUrl, name: station?.name ?? baseUrl } : null,
    isPaid: listenerAuth?.tier !== undefined && listenerAuth.tier !== 'free',
    onNotify: setNotification,
  });

  const playWithPause = async (key: string) => {
    engine.pause();
    return stash.play(key);
  };

  const value = useMemo<StashContextValue>(
    () => ({
      ...stash,
      notification,
      dismissNotification: () => setNotification(null),
      playWithPause,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stash, notification, engine]
  );

  return <StashContext.Provider value={value}>{children}</StashContext.Provider>;
}

export function useStash(): StashContextValue {
  const ctx = useContext(StashContext);
  if (!ctx) throw new Error('useStash must be used within a StashProvider');
  return ctx;
}
