import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { usePathname } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { libraryArtworkUrl } from '@/api/stationClient';
import { ThemedText } from '@/components/themed-text';
import { BottomTabInset, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { usePlayerEngine } from '@/player/PlayerEngine';
import { useStationStore } from '@/state/stationStore';

/**
 * Persistent mini-player, mounted as a sibling of the tab navigator (see
 * `src/app/(tabs)/_layout.tsx`) so it survives tab switches. Mirrors
 * studio/src/components/StickyTransport.tsx's visibility rule (shown on
 * every tab; on Play specifically hidden while the drawer's own big play
 * button is in view) with one addition the web version doesn't need:
 * tapping it opens PlayerDrawer, since mobile has no separate always-visible
 * full player region to switch to.
 */
export function StickyTransportBar() {
  const colors = useTheme();
  const pathname = usePathname();
  const engine = usePlayerEngine();
  const { baseUrl, listenerAuth } = useStationStore();

  const hasContent = !!(engine.track ?? engine.nowPlaying);
  const isPlayTab = pathname === '/play';
  const visible = engine.hasStation && hasContent && (!isPlayTab || !engine.bigPlayButtonVisible);

  if (!visible) return <View pointerEvents="none" />;

  const title = engine.track?.title ?? engine.nowPlaying?.title ?? engine.stationName ?? 'Station';
  const subtitle = engine.track ? (engine.track.artist ?? engine.stationName ?? '') : (engine.nowPlaying?.artist ?? 'Live');

  const artworkTrackId = engine.track?.id ?? engine.nowPlaying?.id ?? null;
  const artworkUrl = baseUrl && artworkTrackId != null ? libraryArtworkUrl(baseUrl, artworkTrackId) : null;
  const authHeaders = listenerAuth?.token ? { Authorization: `Bearer ${listenerAuth.token}` } : undefined;

  return (
    <Pressable
      onPress={engine.openDrawer}
      style={[
        styles.container,
        { bottom: BottomTabInset, backgroundColor: colors.backgroundElement, borderColor: colors.border },
      ]}>
      <View style={[styles.swatch, { backgroundColor: colors.accentSoft }]}>
        {artworkUrl ? (
          <Image source={{ uri: artworkUrl, headers: authHeaders }} style={styles.swatch} contentFit="cover" />
        ) : (
          <ThemedText style={{ color: colors.accent }}>♪</ThemedText>
        )}
      </View>
      <View style={styles.info}>
        <ThemedText type="smallBold" numberOfLines={1} style={styles.infoText}>
          {title}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.infoText}>
          {subtitle}
        </ThemedText>
      </View>
      <Pressable
        onPress={engine.toggle}
        hitSlop={10}
        style={[styles.playButton, { backgroundColor: colors.accent }]}>
        {engine.isBuffering ? (
          <ActivityIndicator color={colors.text} size="small" />
        ) : (
          <Ionicons name={engine.playing ? 'pause' : 'play'} size={16} color={colors.text} />
        )}
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: Spacing.two,
    right: Spacing.two,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.two,
  },
  swatch: {
    width: 40,
    height: 40,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: {
    flex: 1,
    gap: 2,
    alignItems: 'center',
  },
  infoText: {
    textAlign: 'center',
  },
  playButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
