import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming, type SharedValue } from 'react-native-reanimated';
import { useAudioPlayer, useAudioSampleListener, type AudioPlayer } from 'expo-audio';

import { useTheme } from '@/hooks/use-theme';

/**
 * Replaces web's Canvas + AnalyserNode Waveform (studio/src/components/primitives.tsx)
 * — RN has no <canvas>, so this renders a row of Animated.View bars. When the
 * platform/device supports real-time PCM sampling (expo-audio's
 * useAudioSampleListener), bars are RMS-per-bucket driven by real audio data;
 * otherwise a looping idle animation keeps the meter from looking broken.
 */

const BAR_COUNT = 8;

export function LevelMeter({ player, compact = false }: { player: AudioPlayer | null; compact?: boolean }) {
  const colors = useTheme();
  const levels = useSharedValue<number[]>(Array(BAR_COUNT).fill(0.15));
  const idleProgress = useSharedValue(0);
  const supported = !!player?.isAudioSamplingSupported;

  // useAudioSampleListener needs a real AudioPlayer — fall back to a
  // sourceless, silent one when the engine has no active audio player (e.g.
  // during video-kind playback), so this hook can still be called
  // unconditionally on every render.
  const silentPlayer = useAudioPlayer(null);
  useAudioSampleListener(player ?? silentPlayer, (sample) => {
    if (!player) return;
    const frames = sample.channels[0]?.frames;
    if (!frames || frames.length === 0) return;
    const bucketSize = Math.max(1, Math.floor(frames.length / BAR_COUNT));
    const next: number[] = [];
    for (let i = 0; i < BAR_COUNT; i++) {
      const start = i * bucketSize;
      const end = Math.min(start + bucketSize, frames.length);
      let sumSq = 0;
      for (let j = start; j < end; j++) sumSq += frames[j] * frames[j];
      const rms = end > start ? Math.sqrt(sumSq / (end - start)) : 0;
      next.push(Math.min(1, Math.max(0.08, rms * 2.2)));
    }
    levels.value = next;
  });

  useEffect(() => {
    if (supported) return;
    idleProgress.value = withRepeat(withTiming(1, { duration: 1600 }), -1, false);
  }, [supported, idleProgress]);

  const height = compact ? 24 : 40;

  return (
    <View style={[styles.row, { height }]}>
      {Array.from({ length: BAR_COUNT }).map((_, i) => (
        <Bar key={i} index={i} levels={levels} idleProgress={idleProgress} supported={supported} color={colors.accent} />
      ))}
    </View>
  );
}

function Bar({
  index,
  levels,
  idleProgress,
  supported,
  color,
}: {
  index: number;
  levels: SharedValue<number[]>;
  idleProgress: SharedValue<number>;
  supported: boolean;
  color: string;
}) {
  const style = useAnimatedStyle(() => {
    if (supported) {
      const v = levels.value[index] ?? 0.15;
      return { height: `${Math.round(v * 100)}%` };
    }
    const phase = (idleProgress.value + index / BAR_COUNT) % 1;
    const v = 0.25 + 0.55 * Math.abs(Math.sin(phase * Math.PI * 2));
    return { height: `${Math.round(v * 100)}%` };
  }, [supported]);
  return <Animated.View style={[styles.bar, { backgroundColor: color }, style]} />;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
    width: '100%',
  },
  bar: {
    flex: 1,
    borderRadius: 3,
    minHeight: 3,
  },
});
