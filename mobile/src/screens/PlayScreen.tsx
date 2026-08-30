import { Ionicons } from '@expo/vector-icons';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { useEffect, useState } from 'react';

import { LevelMeter } from '@/components/LevelMeter';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { usePlayerEngine } from '@/player/PlayerEngineContext';
import { canStash, formatDuration, type LibraryItem, type OnDemandTrack } from '@/player/types';
import { canonicalizeBaseUrl } from '@/stash/stashStore';
import { useStash } from '@/stash/StashContext';
import { useStationClient, useStationStore } from '@/state/stationStore';

/**
 * The Play drawer's content — ported from studio/src/views/PlayerView.tsx,
 * shaped like mobile/new_play/play.tsx's phone-width mockup rather than the
 * web view's desktop multi-column grid. Sourced entirely off the shared
 * PlayerEngine (usePlayerEngine()) — no separate data fetch for up-next /
 * recently-played.
 */

export function PlayScreen({ onCollapse }: { onCollapse?: () => void }) {
  const colors = useTheme();
  const engine = usePlayerEngine();
  const stash = useStash();
  const stationClient = useStationClient();
  const { baseUrl } = useStationStore();

  // Resolve the currently-playing catalog item (for the stash toggle) —
  // lightweight structure fetch, same pattern as StickyTransportBar.
  const [catalog, setCatalog] = useState<LibraryItem[]>([]);
  useEffect(() => {
    if (!stationClient) return;
    stationClient
      .libraryStructure()
      .then((s) => setCatalog([...s.projects.flatMap((p) => p.tracks), ...s.standalone]))
      .catch(() => undefined);
  }, [stationClient]);

  const currentId = engine.track?.id ?? engine.nowPlaying?.id ?? null;
  const libraryTrack = currentId != null ? catalog.find((t) => t.id === currentId) || null : null;
  const saved =
    libraryTrack && baseUrl ? stash.savedKeys.has(`${canonicalizeBaseUrl(baseUrl)}::${libraryTrack.id}`) : false;

  const isPreview = engine.isPreview;
  const isOnDemand = !!engine.track;
  const title = engine.track?.title || engine.nowPlaying?.title || engine.stationName;
  const subtitle = engine.track
    ? engine.track.artist || (isPreview ? 'Preview' : undefined)
    : engine.nowPlaying?.artist || 'Live';

  const statusLabel = isOnDemand ? (isPreview ? 'Preview' : 'On demand') : engine.liveActive ? 'Live Broadcast' : 'Station Rotation';

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <Pressable
            accessibilityLabel="Collapse player"
            onPress={onCollapse}
            style={[styles.iconButton, { backgroundColor: colors.backgroundElement, borderColor: colors.border }]}>
            <Ionicons name="chevron-down" size={20} color={colors.text} />
          </Pressable>
          <View style={styles.headerCenter}>
            <View style={styles.statusRow}>
              {!isOnDemand && engine.liveActive ? <View style={[styles.liveDot, { backgroundColor: colors.live }]} /> : null}
              <ThemedText type="small" themeColor={!isOnDemand && engine.liveActive ? 'accent' : 'textSecondary'} style={styles.statusLabel}>
                {statusLabel}
              </ThemedText>
            </View>
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              {engine.stationName}
            </ThemedText>
          </View>
          <View style={styles.iconButton} />
        </View>

        <View style={[styles.artwork, { backgroundColor: colors.backgroundElement, borderColor: colors.border }]}>
          <Ionicons name="radio" size={48} color={colors.textSecondary} />
        </View>

        <View style={styles.titleRow}>
          <View style={styles.titleColumn}>
            <ThemedText type="title" style={styles.title} numberOfLines={2}>
              {title}
            </ThemedText>
            {subtitle ? (
              <ThemedText type="default" themeColor="textSecondary" style={styles.subtitle} numberOfLines={1}>
                {subtitle}
              </ThemedText>
            ) : null}
          </View>
          {libraryTrack && canStash(libraryTrack, engine.isPaid) ? (
            <Pressable
              accessibilityLabel={saved ? 'Remove from stash' : 'Save to stash'}
              onPress={() => (saved ? undefined : stash.save(libraryTrack))}
              style={[styles.iconButton, { backgroundColor: colors.backgroundElement, borderColor: colors.border }]}>
              <Ionicons name={saved ? 'bookmark' : 'bookmark-outline'} size={20} color={saved ? colors.accent : colors.text} />
            </Pressable>
          ) : null}
        </View>

        {isOnDemand ? (
          <View style={[styles.progressCard, { backgroundColor: colors.backgroundElement, borderColor: colors.border }]}>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { backgroundColor: colors.accent, width: `${Math.round(engine.odProgress * 100)}%` }]} />
            </View>
            <View style={styles.progressLabels}>
              <ThemedText type="small" themeColor="textSecondary">
                {formatDuration(engine.odElapsed)}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {formatDuration(engine.track?.duration)}
              </ThemedText>
            </View>
          </View>
        ) : (
          <View style={[styles.meterCard, { backgroundColor: colors.backgroundElement, borderColor: colors.border }]}>
            <View style={styles.meterHeader}>
              <ThemedText type="small" themeColor="textSecondary">
                LEVEL METER
              </ThemedText>
              {engine.reconnecting ? (
                <ThemedText type="small" themeColor="accent">
                  Reconnecting…
                </ThemedText>
              ) : (
                <ThemedText type="small" themeColor="textSecondary">
                  {engine.listenerCount} listening
                </ThemedText>
              )}
            </View>
            <LevelMeter player={engine.getActiveAudioPlayer()} />
          </View>
        )}

        <View style={styles.transportRow}>
          <Pressable
            accessibilityLabel="Rewind 15 seconds"
            style={[styles.transportSide, { backgroundColor: colors.backgroundElement }]}>
            <Ionicons name="play-back" size={20} color={colors.textSecondary} />
          </Pressable>
          <Pressable
            accessibilityLabel={engine.playing ? 'Pause' : 'Play'}
            onPress={engine.toggle}
            style={[styles.transportMain, { backgroundColor: colors.accent }]}>
            <Ionicons name={engine.playing ? 'pause' : 'play'} size={28} color="#fff" />
          </Pressable>
          <Pressable
            accessibilityLabel="Forward 15 seconds"
            style={[styles.transportSide, { backgroundColor: colors.backgroundElement }]}>
            <Ionicons name="play-forward" size={20} color={colors.textSecondary} />
          </Pressable>
        </View>

        {isOnDemand ? (
          <Pressable onPress={() => engine.goLive(true)} style={styles.backToLive}>
            <ThemedText type="smallBold" themeColor="accent">
              Back to live
            </ThemedText>
          </Pressable>
        ) : null}

        {engine.stationQueue.length > 0 ? (
          <View style={[styles.listCard, { backgroundColor: colors.backgroundElement, borderColor: colors.border }]}>
            <ThemedText type="smallBold" style={styles.listHeading}>
              Up Next
            </ThemedText>
            {engine.stationQueue.slice(0, 4).map((t) => (
              <Pressable
                key={t.id}
                onPress={() =>
                  engine.selectTrack({
                    id: t.id,
                    title: t.title,
                    artist: t.artist,
                    category: t.category,
                    duration: t.duration,
                    visibility: 'public',
                    isVideo: t.isVideo,
                  } as OnDemandTrack)
                }
                style={styles.listRow}>
                <ThemedText type="default" numberOfLines={1} style={styles.listRowTitle}>
                  {t.title}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {formatDuration(t.duration)}
                </ThemedText>
              </Pressable>
            ))}
          </View>
        ) : null}

        {engine.recentlyPlayed.length > 0 ? (
          <View style={[styles.listCard, { backgroundColor: colors.backgroundElement, borderColor: colors.border }]}>
            <ThemedText type="smallBold" style={styles.listHeading}>
              Recently Played
            </ThemedText>
            {engine.recentlyPlayed.slice(0, 3).map((t, i) => (
              <View key={`${t.id}-${i}`} style={styles.listRow}>
                <View style={styles.listRowInfo}>
                  <ThemedText type="default" numberOfLines={1}>
                    {t.title}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                    {[t.artist, t.playedAt].filter(Boolean).join(' · ')}
                  </ThemedText>
                </View>
                <ThemedText type="small" themeColor="textSecondary">
                  {formatDuration(t.duration)}
                </ThemedText>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { padding: Spacing.three, paddingBottom: Spacing.six, gap: Spacing.three },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerCenter: { flex: 1, alignItems: 'center', gap: 2 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusLabel: { fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
  liveDot: { width: 7, height: 7, borderRadius: 4 },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  artwork: {
    aspectRatio: 1,
    width: '100%',
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: Spacing.two },
  titleColumn: { flex: 1, gap: 2 },
  title: { fontSize: 24, lineHeight: 30 },
  subtitle: {},
  progressCard: { borderRadius: 14, borderWidth: 1, padding: Spacing.three, gap: Spacing.one },
  progressTrack: { height: 4, borderRadius: 2, backgroundColor: 'rgba(128,128,128,0.25)', overflow: 'hidden' },
  progressFill: { height: 4, borderRadius: 2 },
  progressLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  meterCard: { borderRadius: 14, borderWidth: 1, padding: Spacing.three, gap: Spacing.two },
  meterHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  transportRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.four },
  transportSide: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  transportMain: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  backToLive: { alignSelf: 'center' },
  listCard: { borderRadius: 14, borderWidth: 1, padding: Spacing.three, gap: Spacing.one },
  listHeading: { marginBottom: Spacing.one },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.one,
    gap: Spacing.two,
  },
  listRowTitle: { flex: 1 },
  listRowInfo: { flex: 1, gap: 2 },
});
