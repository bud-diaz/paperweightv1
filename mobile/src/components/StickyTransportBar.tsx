import { View } from 'react-native';

/**
 * Empty/collapsed shell. Mounted as a sibling of the tab navigator (see
 * `src/app/(tabs)/_layout.tsx`) so it survives tab switches instead of
 * remounting per screen — Phase 3 fills this in against PlayerEngine and
 * gives it real height/content, matching studio/src/components/StickyTransport.tsx's
 * visibility rules (persistent across tabs, hidden when the Play drawer is
 * fully open).
 */
export function StickyTransportBar() {
  return <View pointerEvents="none" />;
}
