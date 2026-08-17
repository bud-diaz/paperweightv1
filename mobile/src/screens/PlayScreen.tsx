import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { usePlayerEngine } from '@/player/PlayerEngine';

/**
 * The Play tab itself stays deliberately thin — PlayerDrawer (mounted
 * globally in `(tabs)/_layout.tsx`) holds all the real content and opens
 * automatically whenever this tab gains focus, matching the scope doc's
 * "slidable bottom-sheet drawer that opens upward to reveal the current Play
 * tab's full content." This screen only needs to exist for whatever's
 * visible behind the drawer (its opening animation, a manual dismiss) — a
 * station name and a tap-to-reopen affordance, not a duplicate of the
 * drawer's content.
 */
export function PlayScreen() {
  const colors = useTheme();
  const engine = usePlayerEngine();

  useFocusEffect(
    useCallback(() => {
      if (!engine.hasStation) return;
      // A same-tick present() occasionally no-ops if the sheet's host isn't
      // fully mounted yet right as focus fires (found on real hardware) — a
      // frame's delay is enough to make it reliable.
      const timer = setTimeout(() => engine.openDrawer(), 50);
      return () => clearTimeout(timer);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [engine.hasStation])
  );

  return (
    <ThemedView style={styles.container}>
      {engine.hasStation ? (
        <Pressable onPress={engine.openDrawer} style={styles.prompt}>
          <ThemedText type="title" style={styles.title}>
            {engine.stationName}
          </ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.body}>
            Tap to reopen the player.
          </ThemedText>
        </Pressable>
      ) : (
        <ThemedText themeColor="textSecondary" style={styles.body}>
          Select a station on Discover first.
        </ThemedText>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
  },
  prompt: {
    alignItems: 'center',
    gap: Spacing.two,
  },
  title: {
    fontSize: 28,
    lineHeight: 34,
    textAlign: 'center',
  },
  body: {
    textAlign: 'center',
  },
});
