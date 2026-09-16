import { createRef, useCallback, useEffect, useRef, useState, type ComponentRef } from 'react';
import { BackHandler, StyleSheet } from 'react-native';
import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';

import { PlayScreen } from '@/screens/PlayScreen';
import { useTheme } from '@/hooks/use-theme';
import { usePlayerEngine } from '@/player/PlayerEngineContext';

/**
 * Global overlay (mounted as a sibling of <Tabs> in src/app/(tabs)/_layout.tsx)
 * so it survives tab switches. The heavy BottomSheet is mounted lazily only
 * after a real open request; when closed it unmounts so its gesture container
 * cannot intercept bottom-tab taps on short Android screens.
 */
export const playerDrawerRef = createRef<ComponentRef<typeof BottomSheet>>();

let requestOpenPlayerDrawer: (() => void) | null = null;
let requestClosePlayerDrawer: (() => void) | null = null;

export function openPlayerDrawer() {
  requestOpenPlayerDrawer?.();
}

export function closePlayerDrawer() {
  requestClosePlayerDrawer?.();
}

const SNAP_POINTS = ['92%'];

export function PlayerDrawer() {
  const colors = useTheme();
  const engine = usePlayerEngine();
  const [mounted, setMounted] = useState(false);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = mounted;
  }, [mounted]);

  const open = useCallback(() => {
    if (mountedRef.current) {
      playerDrawerRef.current?.expand();
      return;
    }
    setMounted(true);
  }, []);

  const close = useCallback(() => {
    playerDrawerRef.current?.close();
  }, []);

  useEffect(() => {
    requestOpenPlayerDrawer = open;
    requestClosePlayerDrawer = close;
    return () => {
      if (requestOpenPlayerDrawer === open) requestOpenPlayerDrawer = null;
      if (requestClosePlayerDrawer === close) requestClosePlayerDrawer = null;
    };
  }, [close, open]);

  useEffect(() => {
    if (!mounted) return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      close();
      return true;
    });
    return () => subscription.remove();
  }, [close, mounted]);

  const handleClose = useCallback(() => {
    engine.setIsDrawerExpanded(false);
    setMounted(false);
  }, [engine]);

  if (!mounted) return null;

  return (
    <BottomSheet
      ref={playerDrawerRef}
      index={0}
      snapPoints={SNAP_POINTS}
      enableDynamicSizing={false}
      enablePanDownToClose
      backgroundStyle={{ backgroundColor: colors.background }}
      handleIndicatorStyle={{ backgroundColor: colors.border }}
      onChange={(index) => engine.setIsDrawerExpanded(index >= 0)}
      onClose={handleClose}>
      <BottomSheetView style={styles.body}>
        <PlayScreen onCollapse={closePlayerDrawer} />
      </BottomSheetView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1 },
});
