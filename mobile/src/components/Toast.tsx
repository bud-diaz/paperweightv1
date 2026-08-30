import { useEffect, useRef } from 'react';
import { Animated, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { usePlayerEngine } from '@/player/PlayerEngineContext';
import { useStash } from '@/stash/StashContext';

const AUTO_DISMISS_MS = 3000;

/**
 * Single global toast for PlayerEngineContext's and StashContext's
 * `onNotify` messages (save success/failure, quota notices, etc.) — both
 * contexts already captured this state but nothing ever rendered it, so
 * every notify call was silently invisible to the user. Mounted once in
 * src/app/_layout.tsx as a sibling of <Stack> so it overlays every screen,
 * tab or modal. When both are set (shouldn't normally happen — they're
 * triggered by unrelated actions), the player notice wins; it's tied to
 * playback, which is more time-sensitive than a stash save result.
 */
export function Toast() {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const engine = usePlayerEngine();
  const stash = useStash();

  const message = engine.notification ?? stash.notification;
  const dismiss = engine.notification ? engine.dismissNotification : stash.dismissNotification;

  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(12)).current;

  useEffect(() => {
    if (!message) return;
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 180, useNativeDriver: true }),
    ]).start();

    const timer = setTimeout(dismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message]);

  if (!message) return null;

  return (
    <View pointerEvents="box-none" style={[styles.container, { bottom: BottomTabInset + Spacing.six + insets.bottom }]}>
      <Animated.View style={[styles.toast, { backgroundColor: colors.text, opacity, transform: [{ translateY }] }]}>
        <Pressable onPress={dismiss}>
          <ThemedText type="small" themeColor="background" numberOfLines={2} style={styles.text}>
            {message}
          </ThemedText>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: Spacing.three,
    right: Spacing.three,
    alignItems: 'center',
  },
  toast: {
    borderRadius: 999,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.four,
    maxWidth: Platform.select({ web: 480 }),
  },
  text: {
    textAlign: 'center',
  },
});
