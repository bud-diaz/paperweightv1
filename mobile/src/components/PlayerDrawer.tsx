import { createRef, type ComponentRef } from 'react';
import { StyleSheet } from 'react-native';
import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';

import { PlayScreen } from '@/screens/PlayScreen';
import { useTheme } from '@/hooks/use-theme';
import { usePlayerEngine } from '@/player/PlayerEngineContext';

/**
 * Global overlay (mounted as a sibling of <Tabs> in src/app/(tabs)/_layout.tsx,
 * per the implementation plan's explicit recommendation) so it survives tab
 * switches. Closed by default; opened to its single snap point either from
 * the Play tab route or by tapping StickyTransportBar. A module-scoped ref
 * (rather than context) is enough since only one instance of this component
 * is ever mounted.
 */
export const playerDrawerRef = createRef<ComponentRef<typeof BottomSheet>>();

const SNAP_POINTS = ['92%'];

export function PlayerDrawer() {
  const colors = useTheme();
  const engine = usePlayerEngine();

  return (
    <BottomSheet
      ref={playerDrawerRef}
      index={-1}
      snapPoints={SNAP_POINTS}
      enableDynamicSizing={false}
      enablePanDownToClose
      backgroundStyle={{ backgroundColor: colors.background }}
      handleIndicatorStyle={{ backgroundColor: colors.border }}
      onChange={(index) => engine.setIsDrawerExpanded(index >= 0)}>
      <BottomSheetView style={styles.body}>
        <PlayScreen onCollapse={() => playerDrawerRef.current?.close()} />
      </BottomSheetView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1 },
});
