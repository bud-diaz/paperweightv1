import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { useTheme } from '@/hooks/use-theme';

/**
 * There is no RN/Expo equivalent of the web player's real Web Audio
 * AnalyserNode tap (see studio/src/components/primitives.tsx's Waveform) —
 * expo-audio only exposes amplitude metering for the *recorder*, not
 * playback, and real playback sampling (useAudioSampleListener) forces an
 * Android RECORD_AUDIO permission prompt for what would only ever be a
 * decorative visualizer. This animates the web version's own idle/no-analyser
 * fallback bar row instead of faking spectral data — same visual language,
 * honestly not audio-reactive.
 */
const BAR_COUNT = 7;
const BAR_HEIGHTS = [0.35, 0.6, 0.85, 1, 0.7, 0.5, 0.3];

export function LevelMeter({ active }: { active: boolean }) {
  const colors = useTheme();

  return (
    <View style={styles.row}>
      {BAR_HEIGHTS.map((peak, index) => (
        <Bar key={index} peak={peak} active={active} delay={index * 90} color={active ? colors.accent : colors.border} />
      ))}
    </View>
  );
}

function Bar({ peak, active, delay, color }: { peak: number; active: boolean; delay: number; color: string }) {
  const scale = useSharedValue(0.15);

  useEffect(() => {
    if (active) {
      scale.value = withRepeat(withTiming(peak, { duration: 420 + delay }), -1, true);
    } else {
      scale.value = withTiming(0.12, { duration: 300 });
    }
  }, [active, peak, delay, scale]);

  const style = useAnimatedStyle(() => ({ transform: [{ scaleY: scale.value }] }));

  return (
    <View style={styles.track}>
      <Animated.View style={[styles.bar, { backgroundColor: color }, style]} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 6,
    height: 48,
  },
  track: {
    width: 6,
    height: 48,
    justifyContent: 'flex-end',
  },
  bar: {
    width: 6,
    height: 48,
    borderRadius: 3,
  },
});
