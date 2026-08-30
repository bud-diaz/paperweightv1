import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { usePlayerEngine } from '@/player/PlayerEngineContext';
import { canStash, formatDuration, isPlayableTrack, swatchFor, toOnDemandTrack, type LibraryItem, type LibraryProject, type LibraryStructure } from '@/player/types';
import { canonicalizeBaseUrl } from '@/stash/stashStore';
import { useStash } from '@/stash/StashContext';
import { useStationClient, useStationStore } from '@/state/stationStore';

type LoadState = 'loading' | 'ready' | 'error';
type Segment = 'catalog' | 'stash';
const SEARCH_DEBOUNCE_MS = 300;

export function StackScreen() {
  const colors = useTheme();
  const router = useRouter();
  const stationClient = useStationClient();
  const engine = usePlayerEngine();
  const stash = useStash();

  const [segment, setSegment] = useState<Segment>('catalog');
  const [structure, setStructure] = useState<LibraryStructure | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [query, setQuery] = useState('');
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    if (!stationClient) return;
    const requestId = ++requestIdRef.current;
    setLoadState('loading');
    try {
      const result = await stationClient.libraryStructure();
      if (requestId !== requestIdRef.current) return;
      setStructure(result);
      setLoadState('ready');
    } catch {
      if (requestId === requestIdRef.current) setLoadState('error');
    }
  }, [stationClient]);

  useEffect(() => {
    load();
  }, [load]);

  const standalone = structure?.standalone || [];
  const projects = structure?.projects || [];

  const filteredStandalone = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return standalone;
    return standalone.filter((t) => `${t.title} ${t.artist || ''}`.toLowerCase().includes(q));
  }, [standalone, query]);

  const playTrack = (track: LibraryItem) => {
    const onDemand = toOnDemandTrack(track);
    engine.selectTrack(onDemand);
  };

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <ThemedText type="title" style={styles.title}>
          Library
        </ThemedText>
        <View style={[styles.segmentedControl, { backgroundColor: colors.backgroundElement, borderColor: colors.border }]}>
          <Pressable
            onPress={() => setSegment('catalog')}
            style={[styles.segmentButton, segment === 'catalog' && { backgroundColor: colors.accent }]}>
            <ThemedText type="smallBold" style={segment === 'catalog' ? { color: '#fff' } : undefined}>
              Station Stack
            </ThemedText>
          </Pressable>
          <Pressable
            onPress={() => setSegment('stash')}
            style={[styles.segmentButton, segment === 'stash' && { backgroundColor: colors.accent }]}>
            <ThemedText type="smallBold" style={segment === 'stash' ? { color: '#fff' } : undefined}>
              My Stash ({stash.records.length})
            </ThemedText>
          </Pressable>
        </View>
      </View>

      {segment === 'catalog' ? (
        loadState === 'loading' ? (
          <View style={styles.centerFill}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : loadState === 'error' ? (
          <View style={styles.centerFill}>
            <ThemedText themeColor="textSecondary">The catalog is unreachable right now.</ThemedText>
            <Pressable onPress={load}>
              <ThemedText themeColor="accent">Try again</ThemedText>
            </Pressable>
          </View>
        ) : (
          <FlatList
            data={filteredStandalone}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={styles.list}
            ListHeaderComponent={
              <View style={{ gap: Spacing.three }}>
                <View style={[styles.searchBar, { backgroundColor: colors.backgroundElement }]}>
                  <TextInput
                    value={query}
                    onChangeText={setQuery}
                    placeholder="Search the catalog"
                    placeholderTextColor={colors.textSecondary}
                    style={[styles.searchInput, { color: colors.text }]}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>
                {projects.length > 0 ? (
                  <View>
                    <View style={styles.sectionHeader}>
                      <ThemedText type="smallBold">Projects & Releases</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        {projects.length} Collections
                      </ThemedText>
                    </View>
                    <View style={styles.projectGrid}>
                      {projects.map((project: LibraryProject) => (
                        <Pressable
                          key={project.id}
                          onPress={() => router.push({ pathname: '/project/[id]' as never, params: { id: String(project.id) } })}
                          style={[styles.projectCard, { backgroundColor: colors.backgroundElement, borderColor: colors.border }]}>
                          <View style={[styles.projectArt, { backgroundColor: swatchFor(project.id) }]}>
                            <Ionicons name="albums" size={28} color="#fff" />
                          </View>
                          <ThemedText type="smallBold" numberOfLines={1}>
                            {project.name}
                          </ThemedText>
                          <ThemedText type="small" themeColor="textSecondary">
                            {project.tracks.length} tracks
                          </ThemedText>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                ) : null}
                <View style={styles.sectionHeader}>
                  <ThemedText type="smallBold">On-Demand Tracks</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    Station Catalog
                  </ThemedText>
                </View>
              </View>
            }
            renderItem={({ item }) => (
              <TrackRow track={item} active={engine.track?.id === item.id} playing={engine.playing} isPaid={engine.isPaid} onPress={() => playTrack(item)} />
            )}
            ListEmptyComponent={
              <View style={styles.centerFill}>
                <ThemedText themeColor="textSecondary">
                  {query ? 'No tracks match that search.' : 'No tracks are available yet.'}
                </ThemedText>
              </View>
            }
          />
        )
      ) : (
        <FlatList
          data={stash.records}
          keyExtractor={(r) => r.key}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            stash.records.length > 0 ? (
              <View style={[styles.storageCard, { backgroundColor: colors.backgroundElement, borderColor: colors.border }]}>
                <View>
                  <ThemedText type="smallBold">Local Stash Storage</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {(stash.totalSizeBytes / (1024 * 1024)).toFixed(1)} MB used of {stash.records.length} tracks
                  </ThemedText>
                </View>
                <Pressable onPress={() => stash.records.forEach((r) => stash.remove(r.key))}>
                  <ThemedText type="smallBold" themeColor="accent">
                    Clear
                  </ThemedText>
                </Pressable>
              </View>
            ) : null
          }
          renderItem={({ item }) => (
            <View style={[styles.stashRow, { backgroundColor: colors.backgroundElement, borderColor: colors.border }]}>
              <Pressable onPress={() => stash.playWithPause(item.key)} style={styles.stashRowMain}>
                <View style={[styles.projectArt, styles.stashArt, { backgroundColor: swatchFor(item.trackId) }]}>
                  <Ionicons name={stash.playingKey === item.key ? 'pause' : 'play'} size={16} color="#fff" />
                </View>
                <View style={styles.stashInfo}>
                  <ThemedText type="smallBold" numberOfLines={1}>
                    {item.title}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                    {item.artist || item.stationName}
                  </ThemedText>
                </View>
              </Pressable>
              <Pressable accessibilityLabel="Remove from stash" hitSlop={8} onPress={() => stash.remove(item.key)}>
                <Ionicons name="trash-outline" size={18} color={colors.textSecondary} />
              </Pressable>
            </View>
          )}
          ListEmptyComponent={
            <View style={styles.centerFill}>
              <ThemedText themeColor="textSecondary">Nothing stashed yet — save a track from the catalog for offline playback.</ThemedText>
            </View>
          }
        />
      )}
    </ThemedView>
  );
}

function TrackRow({
  track,
  active,
  playing,
  isPaid,
  onPress,
}: {
  track: LibraryItem;
  active: boolean;
  playing: boolean;
  isPaid: boolean;
  onPress: () => void;
}) {
  const colors = useTheme();
  const stash = useStash();
  const { baseUrl } = useStationStore();
  const key = baseUrl ? `${canonicalizeBaseUrl(baseUrl)}::${track.id}` : null;
  const saved = key ? stash.savedKeys.has(key) : false;
  const locked = !isPlayableTrack(track, isPaid);
  const stashable = canStash(track, isPaid);

  return (
    <View style={[styles.trackRow, { backgroundColor: colors.backgroundElement, borderColor: colors.border }]}>
      <Pressable onPress={onPress} style={styles.trackRowMain}>
        <View style={[styles.playDot, { backgroundColor: swatchFor(track.id) }]}>
          <Ionicons name={active && playing ? 'pause' : 'play'} size={14} color="#fff" />
        </View>
        <View style={styles.trackInfo}>
          <ThemedText type="smallBold" numberOfLines={1}>
            {track.title}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {[track.artist, formatDuration(track.duration)].filter(Boolean).join(' · ')}
          </ThemedText>
        </View>
      </Pressable>
      {locked ? (
        <Ionicons name="lock-closed-outline" size={16} color={colors.textSecondary} />
      ) : stashable ? (
        <Pressable
          accessibilityLabel={saved ? 'Remove from stash' : 'Save to stash'}
          hitSlop={8}
          onPress={() => (saved ? stash.remove(key!) : stash.save(track))}>
          <Ionicons name={saved ? 'bookmark' : 'bookmark-outline'} size={16} color={saved ? colors.accent : colors.textSecondary} />
        </Pressable>
      ) : (
        <Ionicons name="lock-closed-outline" size={16} color={`${colors.textSecondary}55`} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: Spacing.three, paddingTop: Spacing.three, gap: Spacing.three },
  title: { fontSize: 32, lineHeight: 38 },
  segmentedControl: { flexDirection: 'row', borderRadius: 14, borderWidth: 1, padding: 4, gap: 4 },
  segmentButton: { flex: 1, paddingVertical: Spacing.two, borderRadius: 10, alignItems: 'center' },
  list: { padding: Spacing.three, gap: Spacing.two },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: Spacing.two },
  searchBar: { borderRadius: 999, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  searchInput: { fontSize: 15 },
  projectGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginTop: Spacing.two },
  projectCard: { width: '48%', borderRadius: 14, borderWidth: 1, padding: Spacing.two, gap: Spacing.one },
  projectArt: { aspectRatio: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  stashArt: { width: 40, height: 40, aspectRatio: undefined },
  trackRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderRadius: 14, borderWidth: 1, padding: Spacing.two },
  trackRowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  playDot: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  trackInfo: { flex: 1, gap: 1 },
  stashRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderRadius: 14, borderWidth: 1, padding: Spacing.two },
  stashRowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  stashInfo: { flex: 1, gap: 1 },
  storageCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 14,
    borderWidth: 1,
    padding: Spacing.three,
    marginBottom: Spacing.two,
  },
  centerFill: { alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.six, gap: Spacing.two },
});
