import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { getDirectory, searchStations, sortStations, type DirectoryStation } from '@/api/systemPape';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useStationStore } from '@/state/stationStore';

type LoadState = 'loading' | 'ready' | 'error';

const SEARCH_DEBOUNCE_MS = 300;

export function DiscoverScreen() {
  const colors = useTheme();
  const router = useRouter();
  const { station, baseUrl, setStation } = useStationStore();

  const [query, setQuery] = useState('');
  const [stations, setStations] = useState<DirectoryStation[]>([]);
  const [mode, setMode] = useState<'directory' | 'search'>('directory');
  const [loadState, setLoadState] = useState<LoadState>('loading');

  const requestIdRef = useRef(0);

  const load = useCallback(async (q: string) => {
    const trimmed = q.trim();
    const nextMode = trimmed ? 'search' : 'directory';
    setMode(nextMode);
    const requestId = ++requestIdRef.current;
    setLoadState('loading');
    try {
      const results = nextMode === 'search' ? await searchStations(trimmed, 20) : await getDirectory();
      if (requestId !== requestIdRef.current) return;
      setStations(sortStations(results));
      setLoadState('ready');
    } catch {
      if (requestId === requestIdRef.current) setLoadState('error');
    }
  }, []);

  useEffect(() => {
    load('');
  }, [load]);

  useEffect(() => {
    if (!query.trim()) {
      load('');
      return;
    }
    const timer = setTimeout(() => load(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, load]);

  const selectStation = (entry: DirectoryStation) => {
    if (!entry.url) return;
    setStation({ publicUrl: entry.url, slug: entry.slug, name: entry.name || entry.slug || 'Untitled station' });
  };

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <ThemedText type="title" style={styles.title}>
          Discover
        </ThemedText>

        {station ? (
          <View style={[styles.currentStation, { backgroundColor: colors.backgroundElement, borderColor: colors.border }]}>
            <View style={styles.currentStationInfo}>
              <ThemedText type="small" themeColor="textSecondary">
                Listening station
              </ThemedText>
              <ThemedText type="smallBold" numberOfLines={1}>
                {station.name}
              </ThemedText>
            </View>
            <Pressable
              onPress={() => router.push('/listener-login')}
              style={({ pressed }) => [
                styles.loginButton,
                { backgroundColor: colors.accentSoft, opacity: pressed ? 0.7 : 1 },
              ]}>
              <ThemedText type="smallBold" themeColor="accent">
                Log in
              </ThemedText>
            </Pressable>
          </View>
        ) : null}

        <View style={[styles.searchBar, { backgroundColor: colors.backgroundElement }]}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search stations"
            placeholderTextColor={colors.textSecondary}
            style={[styles.searchInput, { color: colors.text }]}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          {query.length > 0 ? (
            <Pressable onPress={() => setQuery('')} hitSlop={8}>
              <ThemedText themeColor="textSecondary">Clear</ThemedText>
            </Pressable>
          ) : null}
        </View>

        <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
          {mode === 'search' ? 'Search results' : 'Directory'}
        </ThemedText>
      </View>

      {loadState === 'loading' ? (
        <View style={styles.centerFill}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : loadState === 'error' ? (
        <View style={styles.centerFill}>
          <ThemedText themeColor="textSecondary" style={styles.centerText}>
            The station directory is unreachable right now.
          </ThemedText>
          <Pressable onPress={() => load(query)} style={styles.retryButton}>
            <ThemedText themeColor="accent">Try again</ThemedText>
          </Pressable>
        </View>
      ) : stations.length === 0 ? (
        <View style={styles.centerFill}>
          <ThemedText themeColor="textSecondary" style={styles.centerText}>
            {mode === 'search'
              ? 'No stations match that search.'
              : 'No stations are listed right now — creators opt in, so check back.'}
          </ThemedText>
        </View>
      ) : (
        <FlatList
          data={stations}
          keyExtractor={(item, index) => item.url || item.slug || String(index)}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const selected = Boolean(baseUrl) && item.url === station?.publicUrl;
            return (
              <Pressable
                onPress={() => selectStation(item)}
                style={({ pressed }) => [
                  styles.row,
                  {
                    backgroundColor: colors.backgroundElement,
                    borderColor: selected ? colors.accent : 'transparent',
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}>
                <View style={styles.rowTop}>
                  <ThemedText type="smallBold" numberOfLines={1} style={styles.rowName}>
                    {item.name || item.slug || 'Untitled station'}
                  </ThemedText>
                  {item.live ? (
                    <View style={styles.liveBadge}>
                      <View style={[styles.liveDot, { backgroundColor: colors.live }]} />
                      <ThemedText type="small" style={{ color: colors.live }}>
                        Live
                      </ThemedText>
                    </View>
                  ) : (
                    <ThemedText type="small" themeColor="textSecondary">
                      Off air
                    </ThemedText>
                  )}
                </View>
                <View style={styles.rowMeta}>
                  <ThemedText type="small" themeColor="textSecondary">
                    {item.listeners} listening
                  </ThemedText>
                  {item.nowPlaying ? (
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.rowMetaFlex}>
                      {' ▸ '}
                      {item.nowPlaying}
                    </ThemedText>
                  ) : null}
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </ThemedView>
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
  currentStation: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  currentStationInfo: {
    flexShrink: 1,
    gap: 2,
  },
  loginButton: {
    borderRadius: 999,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
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
  sectionLabel: {
    marginTop: Spacing.one,
  },
  list: {
    padding: Spacing.three,
    paddingTop: Spacing.one,
    gap: Spacing.two,
  },
  row: {
    borderRadius: 14,
    borderWidth: 1.5,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  rowName: {
    flexShrink: 1,
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  rowMeta: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowMetaFlex: {
    flexShrink: 1,
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
  retryButton: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
  },
});
