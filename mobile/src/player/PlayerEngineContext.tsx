import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

import { useStationClient, useStationStore } from '@/state/stationStore';
import { usePlayerEngineState, type PlayerEngine } from '@/player/PlayerEngine';

/**
 * Shares one PlayerEngine instance across the whole app — StickyTransportBar
 * (mounted at the tabs-layout level), PlayScreen/PlayerDrawer, and
 * StackScreen all need to observe/control the same playback session. If each
 * called usePlayerEngineState() independently, each would spin up its own
 * AudioPlayer/VideoPlayer + 10s poll loop: duplicate audio output and
 * inconsistent state. Mounted once in src/app/_layout.tsx, inside
 * StationStoreProvider (the engine depends on useStationClient()).
 */

type PlayerEngineContextValue = PlayerEngine & {
  /** Whether the Play drawer is at its fully-expanded snap point — StickyTransportBar hides while true. */
  isDrawerExpanded: boolean;
  setIsDrawerExpanded: (expanded: boolean) => void;
  /** Last transport/quota notice (e.g. "on-demand plays used"), for a toast — null once dismissed. */
  notification: string | null;
  dismissNotification: () => void;
};

const PlayerEngineContext = createContext<PlayerEngineContextValue | null>(null);

export function PlayerEngineProvider({ children }: { children: ReactNode }) {
  const stationClient = useStationClient();
  const { station, listenerAuth } = useStationStore();
  const [isDrawerExpanded, setIsDrawerExpanded] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);

  const engine = usePlayerEngineState({
    stationClient,
    isPaid: listenerAuth?.tier !== undefined && listenerAuth.tier !== 'free',
    stationName: station?.name || 'This station',
    onNotify: setNotification,
  });

  const value = useMemo<PlayerEngineContextValue>(
    () => ({
      ...engine,
      isDrawerExpanded,
      setIsDrawerExpanded,
      notification,
      dismissNotification: () => setNotification(null),
    }),
    [engine, isDrawerExpanded, notification]
  );

  return <PlayerEngineContext.Provider value={value}>{children}</PlayerEngineContext.Provider>;
}

export function usePlayerEngine(): PlayerEngineContextValue {
  const ctx = useContext(PlayerEngineContext);
  if (!ctx) throw new Error('usePlayerEngine must be used within a PlayerEngineProvider');
  return ctx;
}
