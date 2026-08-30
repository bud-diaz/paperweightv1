import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';

import { playerDrawerRef } from '@/components/PlayerDrawer';

/**
 * The Play tab route has no screen content of its own — visiting it expands
 * the globally-mounted PlayerDrawer (see (tabs)/_layout.tsx) to its full
 * snap point, since PlayerDrawer's content (PlayScreen) is the drawer's body
 * regardless of whether it was opened from this tab or from
 * StickyTransportBar.
 */
export default function PlayScreenRoute() {
  useFocusEffect(
    useCallback(() => {
      playerDrawerRef.current?.expand();
    }, [])
  );
  return null;
}
