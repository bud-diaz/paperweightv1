import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { usePlayerEngine } from '@/player/PlayerEngineContext';
import { canStash, formatDuration, isPlayableTrack, swatchFor, toOnDemandTrack, type LibraryProject } from '@/player/types';
import { canonicalizeBaseUrl } from '@/stash/stashStore';
import { useStash } from '@/stash/StashContext';
import { useStationClient, useStationStore } from '@/state/stationStore';

/**
 * A collection's full tracklist — pushed from StackScreen's project grid.
 * Ports studio/src/views/StackView.tsx's "stack-collection-drawer" content
 * as a separate screen rather than an in-place expand, matching
 * mobile/new_play/stack.tsx's flatter top-level layout.
 */
export function ProjectDetailScreen({ projectId }: { projectId: number }) {
  const colors = useTheme();
  const stationClient = useStationClient();
  const engine = usePlayerEngine();
  const stash = useStash();
  const { baseUrl } = useStationStore();

  const [project, setProject] = useState<LibraryProject | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!stationClient) return;
    setLoading(true);
    stationClient
      .libraryStructure()
      .then((s) => setProject(s.projects.find((p) => p.id === projectId) || null))
      .finally(() => setLoading(false));
  }, [stationClient, projectId]);

  const genres = useMemo(() => {
    if (!project) return [];
    const seen = new Set<string>();
    return project.tracks
      .map((t) => t.genre)
      .filter((g): g is string => !!g && !seen.has(g) && !!seen.add(g))
      .slice(0, 3);
  }, [project]);

  const totalDuration = useMemo(() => (project ? project.tracks.reduce((sum, t) => sum + (t.duration || 0), 0) : 0), [project]);

  if (loading) {
    return (
      <ThemedView style={styles.centerFill}>
        <ActivityIndicator color={colors.accent} />
      </ThemedView>
    );
  }

  if (!project) {
    return (
      <ThemedView style={styles.centerFill}>
        <ThemedText themeColor="textSecondary">Collection not found.</ThemedText>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <FlatList
        data={project.tracks}
        keyExtractor={(t) => String(t.id)}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.headerBlock}>
            <View style={[styles.art, { backgroundColor: swatchFor(project.id) }]}>
              <Ionicons name="disc" size={40} color="#fff" />
            </View>
            <ThemedText type="title" style={styles.projectTitle}>
              {project.name}
            </ThemedText>
            {project.description ? (
              <ThemedText type="default" themeColor="textSecondary">
                {project.description}
              </ThemedText>
            ) : null}
            {genres.length > 0 ? (
              <View style={styles.chipRow}>
                {genres.map((g) => (
                  <View key={g} style={[styles.chip, { backgroundColor: colors.backgroundElement, borderColor: colors.border }]}>
                    <ThemedText type="small">{g}</ThemedText>
                  </View>
                ))}
              </View>
            ) : null}
            <View style={[styles.metaRow, { borderColor: colors.border }]}>
              <MetaCell label="Tracks" value={String(project.tracks.length)} />
              <MetaCell label="Runtime" value={formatDuration(totalDuration)} />
              <MetaCell label="Artist" value={project.tracks.find((t) => t.artist)?.artist || 'Various'} />
            </View>
          </View>
        }
        renderItem={({ item, index }) => {
          const locked = !isPlayableTrack(item, engine.isPaid);
          const stashable = canStash(item, engine.isPaid);
          const key = baseUrl ? `${canonicalizeBaseUrl(baseUrl)}::${item.id}` : null;
          const saved = key ? stash.savedKeys.has(key) : false;
          return (
            <Pressable onPress={() => engine.selectTrack(toOnDemandTrack(item))} style={styles.trackRow}>
              <ThemedText type="small" themeColor="textSecondary" style={styles.trackIndex}>
                {String(index + 1).padStart(2, '0')}
              </ThemedText>
              <ThemedText type="default" numberOfLines={1} style={styles.trackTitle}>
                {item.title}
              </ThemedText>
              {locked ? (
                <Ionicons name="lock-closed-outline" size={15} color={colors.textSecondary} />
              ) : stashable ? (
                <Pressable accessibilityLabel={saved ? 'Remove from stash' : 'Save to stash'} onPress={() => (saved ? stash.remove(key!) : stash.save(item))}>
                  <Ionicons name={saved ? 'bookmark' : 'bookmark-outline'} size={15} color={saved ? colors.accent : colors.textSecondary} />
                </Pressable>
              ) : null}
              <ThemedText type="small" themeColor="textSecondary" style={styles.trackDuration}>
                {formatDuration(item.duration)}
              </ThemedText>
            </Pressable>
          );
        }}
      />
    </ThemedView>
  );
}

function MetaCell({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaCell}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="smallBold" numberOfLines={1}>
        {value}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: Spacing.three, gap: Spacing.one },
  headerBlock: { gap: Spacing.two, marginBottom: Spacing.three },
  art: { aspectRatio: 1.6, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  projectTitle: { fontSize: 26, lineHeight: 32 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  chip: { borderRadius: 999, borderWidth: 1, paddingHorizontal: Spacing.two, paddingVertical: 4 },
  metaRow: { flexDirection: 'row', borderTopWidth: 1, paddingTop: Spacing.two, gap: Spacing.three },
  metaCell: { flex: 1, gap: 2 },
  trackRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two },
  trackIndex: { width: 24 },
  trackTitle: { flex: 1 },
  trackDuration: { width: 44, textAlign: 'right' },
});
