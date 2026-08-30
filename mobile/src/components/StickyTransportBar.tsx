import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { usePlayerEngine } from '@/player/PlayerEngineContext';
import { canStash, isPlayableTrack, type LibraryItem } from '@/player/types';
import { playerDrawerRef } from '@/components/PlayerDrawer';
import { canonicalizeBaseUrl } from '@/stash/stashStore';
import { useStash } from '@/stash/StashContext';
import { useStationClient, useStationStore } from '@/state/stationStore';

/**
 * Persistent mini-player — port of studio/src/components/StickyTransport.tsx.
 * Mounted as a sibling of <Tabs> in (tabs)/_layout.tsx so it survives tab
 * switches instead of remounting per screen. Renders nothing when there's no
 * active track/live now-playing, and hides while the Play drawer is fully
 * expanded (its own content already shows this info).
 */
export function StickyTransportBar() {
  const colors = useTheme();
  const engine = usePlayerEngine();
  const stash = useStash();
  const stationClient = useStationClient();
  const { baseUrl } = useStationStore();

  const [catalog, setCatalog] = useState<LibraryItem[]>([]);
  useEffect(() => {
    if (!stationClient) return;
    stationClient
      .libraryStructure()
      .then((s) => setCatalog([...s.projects.flatMap((p) => p.tracks), ...s.standalone]))
      .catch(() => undefined);
  }, [stationClient]);

  const hasTrack = !!(engine.track || engine.nowPlaying);
  if (!hasTrack || engine.isDrawerExpanded) return <View pointerEvents="none" />;

  const activeTrack = engine.track;
  const currentId = activeTrack?.id ?? engine.nowPlaying?.id ?? null;
  const libraryTrack = currentId != null ? catalog.find((t) => t.id === currentId) || null : null;
  const stashKey = libraryTrack && baseUrl ? `${canonicalizeBaseUrl(baseUrl)}::${libraryTrack.id}` : null;
  const saved = stashKey ? stash.savedKeys.has(stashKey) : false;
  const stashable = libraryTrack ? canStash(libraryTrack, engine.isPaid) : false;

  const skipLocked =
    !engine.isPaid ||
    engine.isPreview ||
    !isPlayableTrack(
      { visibility: activeTrack?.visibility || 'public', unlocked: activeTrack?.unlocked, isExternal: activeTrack?.isExternal },
      engine.isPaid
    );

  const title = activeTrack?.title || engine.nowPlaying?.title || engine.stationName;
  const subtitle = activeTrack ? activeTrack.artist : engine.nowPlaying?.artist || 'Live';

  return (
    <Pressable
      onPress={() => playerDrawerRef.current?.expand()}
      style={[styles.bar, { backgroundColor: colors.backgroundElement, borderColor: colors.border, bottom: BottomTabInset }]}>
      <View style={[styles.swatch, { backgroundColor: colors.accentSoft }]}>
        <Ionicons name="radio" size={16} color={colors.accent} />
      </View>
      <View style={styles.info}>
        <ThemedText type="smallBold" numberOfLines={1}>
          {title}
        </ThemedText>
        {subtitle ? (
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {subtitle}
          </ThemedText>
        ) : null}
      </View>
      <View style={styles.controls}>
        {activeTrack ? (
          <Ionicons name={skipLocked ? 'lock-closed-outline' : 'play-skip-back'} size={16} color={colors.textSecondary} style={styles.controlIcon} />
        ) : null}
        <Pressable
          accessibilityLabel={engine.playing ? 'Pause' : 'Play'}
          onPress={engine.toggle}
          style={[styles.playButton, { backgroundColor: colors.accent }]}>
          <Ionicons name={engine.playing ? 'pause' : 'play'} size={16} color="#fff" />
        </Pressable>
        {activeTrack ? (
          <Ionicons name={skipLocked ? 'lock-closed-outline' : 'play-skip-forward'} size={16} color={colors.textSecondary} style={styles.controlIcon} />
        ) : null}
        {libraryTrack && stashable ? (
          <Pressable
            accessibilityLabel={saved ? 'Remove from stash' : 'Save to stash'}
            onPress={() => (saved ? undefined : stash.save(libraryTrack))}
            style={styles.controlIcon}>
            <Ionicons name={saved ? 'bookmark' : 'bookmark-outline'} size={16} color={saved ? colors.accent : colors.textSecondary} />
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: Spacing.two,
    right: Spacing.two,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.two,
  },
  swatch: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: { flex: 1, gap: 1 },
  controls: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  controlIcon: { width: 20, alignItems: 'center' },
  playButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
