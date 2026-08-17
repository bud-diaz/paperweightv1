import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, SectionList, StyleSheet, TextInput, View } from 'react-native';

import type { LibraryProject, LibraryTrack } from '@/api/stationClient';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { canStash, isPlayableTrack, usePlayerEngine, type OnDemandTrack } from '@/player/PlayerEngine';
import { type StashRecord, useStashStore } from '@/stash/stashStore';
import { useStationClient, useStationStore } from '@/state/stationStore';

type LoadState = 'loading' | 'ready' | 'error';
type CatalogTrack = LibraryTrack & { collection: string };

function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '--:--';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  return mb >= 1000 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(1)} MB`;
}

function toOnDemandTrack(track: LibraryTrack): OnDemandTrack {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    category: track.category,
    duration: track.duration,
    visibility: track.visibility,
    unlocked: track.unlocked,
    isExternal: track.isExternal,
    isVideo: track.isVideo,
    mimeType: track.mimeType,
    offlineAllowed: track.offlineAllowed,
  };
}

type Row = { kind: 'track'; track: CatalogTrack } | { kind: 'stash'; record: StashRecord };

export function StackScreen() {
  const colors = useTheme();
  const { baseUrl, station, listenerAuth } = useStationStore();
  const client = useStationClient();
  const engine = usePlayerEngine();

  const [structureState, setStructureState] = useState<LoadState>('loading');
  const [projects, setProjects] = useState<LibraryProject[]>([]);
  const [standalone, setStandalone] = useState<LibraryTrack[]>([]);
  const [search, setSearch] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = useCallback((message: string) => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    setNotice(message);
    noticeTimerRef.current = setTimeout(() => setNotice(null), 2500);
  }, []);
  useEffect(() => () => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
  }, []);

  const stash = useStashStore(notify);
  const isPaid = !!listenerAuth?.tier && listenerAuth.tier !== 'free';

  useEffect(() => {
    if (!client) {
      setProjects([]);
      setStandalone([]);
      setStructureState('ready');
      return;
    }
    let cancelled = false;
    setStructureState('loading');
    client
      .libraryStructure()
      .then((data) => {
        if (cancelled) return;
        setProjects(data.projects || []);
        setStandalone(data.standalone || []);
        setStructureState('ready');
      })
      .catch(() => {
        if (!cancelled) setStructureState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  const allTracks = useMemo<CatalogTrack[]>(() => {
    return [
      ...projects.flatMap((project) => project.tracks.map((track) => ({ ...track, collection: project.name }))),
      ...standalone.map((track) => ({ ...track, collection: track.category || 'Standalone' })),
    ];
  }, [projects, standalone]);

  const filtered = useMemo(() => {
    let list = allTracks;
    if (selectedProjectId != null) {
      const project = projects.find((p) => p.id === selectedProjectId);
      list = project ? project.tracks.map((track) => ({ ...track, collection: project.name })) : [];
    }
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((track) => `${track.title} ${track.collection}`.toLowerCase().includes(q));
  }, [allTracks, projects, selectedProjectId, search]);

  const selectTrack = useCallback(
    (track: LibraryTrack) => {
      if (!baseUrl) return;
      stash.stop();
      engine.selectTrack(toOnDemandTrack(track), isPaid);
    },
    [baseUrl, stash, engine, isPaid]
  );

  const toggleStash = useCallback(
    (track: LibraryTrack) => {
      if (!baseUrl || !client) return;
      if (stash.isSaved(baseUrl, track.id)) {
        stash.removeForTrack(baseUrl, track.id);
        return;
      }
      stash.save({ id: track.id, title: track.title, artist: track.artist, mimeType: track.mimeType }, baseUrl, station?.name ?? 'Station', client);
    },
    [baseUrl, client, station, stash]
  );

  const playStash = useCallback(
    (record: StashRecord) => {
      engine.pause();
      stash.play(record.key);
    },
    [engine, stash]
  );

  const sections = useMemo(
    () => [
      { key: 'catalog', title: `ALL WORKS (${filtered.length})`, data: filtered.map((track): Row => ({ kind: 'track', track })) },
      { key: 'stash', title: `STASH · ${stash.records.length} saved · ${formatBytes(stash.totalBytes)}`, data: stash.records.map((record): Row => ({ kind: 'stash', record })) },
    ],
    [filtered, stash.records, stash.totalBytes]
  );

  if (!baseUrl) {
    return (
      <ThemedView style={styles.container}>
        <View style={styles.centerFill}>
          <ThemedText themeColor="textSecondary" style={styles.centerText}>
            Select a station on Discover first.
          </ThemedText>
        </View>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <ThemedText type="title" style={styles.title}>
          Stack
        </ThemedText>
        {notice ? (
          <ThemedText type="small" themeColor="accent">
            {notice}
          </ThemedText>
        ) : null}
        <View style={[styles.searchBar, { backgroundColor: colors.backgroundElement }]}>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search the catalog"
            placeholderTextColor={colors.textSecondary}
            style={[styles.searchInput, { color: colors.text }]}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          {search.length > 0 ? (
            <Pressable onPress={() => setSearch('')} hitSlop={8}>
              <ThemedText themeColor="textSecondary">Clear</ThemedText>
            </Pressable>
          ) : null}
        </View>
        {projects.length > 0 ? (
          <SectionListChips
            projects={projects}
            selectedProjectId={selectedProjectId}
            onSelect={(id) => setSelectedProjectId(id === selectedProjectId ? null : id)}
          />
        ) : null}
      </View>

      {structureState === 'loading' ? (
        <View style={styles.centerFill}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : structureState === 'error' ? (
        <View style={styles.centerFill}>
          <ThemedText themeColor="textSecondary" style={styles.centerText}>
            Couldn&apos;t load the catalog. Check the station connection.
          </ThemedText>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(row) => (row.kind === 'track' ? `track-${row.track.id}` : `stash-${row.record.key}`)}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={styles.list}
          renderSectionHeader={({ section }) => (
            <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
              {section.title}
            </ThemedText>
          )}
          renderSectionFooter={({ section }) =>
            section.key === 'catalog' && filtered.length === 0 ? (
              <ThemedText themeColor="textSecondary" style={[styles.centerText, styles.emptySection]}>
                {search ? 'Nothing matches that search.' : 'Nothing in the catalog yet.'}
              </ThemedText>
            ) : section.key === 'stash' && stash.records.length === 0 ? (
              <ThemedText themeColor="textSecondary" style={[styles.centerText, styles.emptySection]}>
                Nothing stashed yet — tap the bookmark icon on a track to save it for offline playback.
              </ThemedText>
            ) : null
          }
          renderItem={({ item }) =>
            item.kind === 'track' ? (
              <TrackRow
                track={item.track}
                active={engine.track?.id === item.track.id}
                playing={engine.playing}
                isPaid={isPaid}
                saved={stash.isSaved(baseUrl, item.track.id)}
                onSelect={() => selectTrack(item.track)}
                onToggleStash={canStash(toOnDemandTrack(item.track), isPaid) ? () => toggleStash(item.track) : undefined}
              />
            ) : (
              <StashRow
                record={item.record}
                active={stash.playingKey === item.record.key}
                playing={stash.playing && stash.playingKey === item.record.key}
                onSelect={() => playStash(item.record)}
                onRemove={() => stash.remove(item.record.key)}
              />
            )
          }
          ListFooterComponent={
            stash.records.length > 0 ? (
              <Pressable onPress={stash.clearAll} style={styles.clearButton}>
                <ThemedText type="small" themeColor="textSecondary">
                  Clear Stash
                </ThemedText>
              </Pressable>
            ) : null
          }
        />
      )}
    </ThemedView>
  );
}

function SectionListChips({
  projects,
  selectedProjectId,
  onSelect,
}: {
  projects: LibraryProject[];
  selectedProjectId: number | null;
  onSelect: (id: number) => void;
}) {
  const colors = useTheme();
  return (
    <View style={styles.chipRow}>
      {projects.map((project) => {
        const selected = project.id === selectedProjectId;
        return (
          <Pressable
            key={project.id}
            onPress={() => onSelect(project.id)}
            style={[
              styles.chip,
              { backgroundColor: selected ? colors.accentSoft : colors.backgroundElement, borderColor: selected ? colors.accent : 'transparent' },
            ]}>
            <ThemedText type="small" themeColor={selected ? 'accent' : 'text'} numberOfLines={1}>
              {project.name}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

function TrackRow({
  track,
  active,
  playing,
  isPaid,
  saved,
  onSelect,
  onToggleStash,
}: {
  track: CatalogTrack;
  active: boolean;
  playing: boolean;
  isPaid: boolean;
  saved: boolean;
  onSelect: () => void;
  onToggleStash?: () => void;
}) {
  const colors = useTheme();
  const locked = !isPlayableTrack(toOnDemandTrack(track), isPaid);
  return (
    <View style={[styles.row, { backgroundColor: colors.backgroundElement, borderColor: active ? colors.accent : 'transparent' }]}>
      <Pressable onPress={onSelect} style={styles.rowPlay} hitSlop={8}>
        <Ionicons name={active && playing ? 'pause-circle' : 'play-circle'} size={28} color={active ? colors.accent : colors.text} />
      </Pressable>
      <View style={styles.rowInfo}>
        <ThemedText type="smallBold" numberOfLines={1}>
          {track.title}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {[track.artist, track.collection].filter(Boolean).join(' · ')}
        </ThemedText>
      </View>
      {locked ? <Ionicons name="lock-closed-outline" size={14} color={colors.textSecondary} /> : null}
      {onToggleStash ? (
        <Pressable onPress={onToggleStash} hitSlop={8} style={styles.rowStash}>
          <Ionicons name={saved ? 'bookmark' : 'bookmark-outline'} size={18} color={saved ? colors.accent : colors.textSecondary} />
        </Pressable>
      ) : null}
      <ThemedText type="small" themeColor="textSecondary" style={styles.rowDuration}>
        {formatDuration(track.duration)}
      </ThemedText>
    </View>
  );
}

function StashRow({
  record,
  active,
  playing,
  onSelect,
  onRemove,
}: {
  record: StashRecord;
  active: boolean;
  playing: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const colors = useTheme();
  return (
    <View style={[styles.row, { backgroundColor: colors.backgroundElement, borderColor: active ? colors.accent : 'transparent' }]}>
      <Pressable onPress={onSelect} style={styles.rowPlay} hitSlop={8}>
        <Ionicons name={active && playing ? 'pause-circle' : 'play-circle'} size={28} color={active ? colors.accent : colors.text} />
      </Pressable>
      <View style={styles.rowInfo}>
        <ThemedText type="smallBold" numberOfLines={1}>
          {record.title}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {record.artist || `Saved from ${record.stationName}`}
        </ThemedText>
      </View>
      <Pressable onPress={onRemove} hitSlop={8} style={styles.rowStash}>
        <Ionicons name="trash-outline" size={18} color={colors.textSecondary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    gap: Spacing.two,
  },
  title: {
    fontSize: 32,
    lineHeight: 38,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: Spacing.one,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.one,
  },
  chip: {
    borderRadius: 999,
    borderWidth: 1.5,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
    maxWidth: 180,
  },
  sectionLabel: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.one,
  },
  list: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.five,
    gap: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: 14,
    borderWidth: 1.5,
    padding: Spacing.two,
  },
  rowPlay: {
    flexShrink: 0,
  },
  rowInfo: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  rowStash: {
    flexShrink: 0,
  },
  rowDuration: {
    flexShrink: 0,
    width: 40,
    textAlign: 'right',
  },
  emptySection: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  clearButton: {
    alignSelf: 'center',
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
  centerFill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
  centerText: {
    textAlign: 'center',
  },
});
