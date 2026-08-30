import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { DashboardClientError, type DashboardMediaItem, type DashboardPost } from '@/api/dashboardClient';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useDashboardClient } from '@/state/dashboardAuthStore';

type LoadState = 'loading' | 'ready' | 'error';

export function ReleaseSchedulingScreen() {
  const colors = useTheme();
  const router = useRouter();
  const client = useDashboardClient();

  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [scheduledMedia, setScheduledMedia] = useState<DashboardMediaItem[]>([]);
  const [scheduledPosts, setScheduledPosts] = useState<DashboardPost[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const requestIdRef = useRef(0);

  const handleAuthError = useCallback(
    (err: unknown) => {
      if (err instanceof DashboardClientError && err.status === 401) {
        router.replace('/(tabs)/studio');
        return true;
      }
      return false;
    },
    [router]
  );

  const load = useCallback(async () => {
    if (!client) return;
    const requestId = ++requestIdRef.current;
    setLoadState('loading');
    try {
      const [media, posts] = await Promise.all([client.mediaList(), client.postsList()]);
      if (requestId !== requestIdRef.current) return;
      const nowIso = new Date().toISOString();
      setScheduledMedia(media.filter((item) => !!item.release_at));
      setScheduledPosts(posts.filter((post) => post.published_at > nowIso));
      setLoadState('ready');
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      if (!handleAuthError(err)) setLoadState('error');
    }
  }, [client, handleAuthError]);

  useEffect(() => {
    load();
  }, [load]);

  async function cancelMediaRelease(item: DashboardMediaItem) {
    if (!client) return;
    setBusyKey(`media-${item.id}`);
    setActionError(null);
    try {
      const { res, data } = await client.mediaUpdate(item.id, { release_at: null });
      if (!res.ok) throw new Error(data.error || 'Could not cancel');
      await load();
    } catch (err) {
      if (!handleAuthError(err)) setActionError('Could not cancel that release — try again.');
    } finally {
      setBusyKey(null);
    }
  }

  async function publishPostNow(post: DashboardPost) {
    if (!client) return;
    setBusyKey(`post-${post.id}`);
    setActionError(null);
    try {
      const { res, data } = await client.postUpdate(post.id, { publishedAt: null });
      if (!res.ok) throw new Error(data.error || 'Could not publish');
      await load();
    } catch (err) {
      if (!handleAuthError(err)) setActionError('Could not publish that post now — try again.');
    } finally {
      setBusyKey(null);
    }
  }

  if (loadState === 'loading') {
    return (
      <ThemedView style={styles.centerFill}>
        <ActivityIndicator color={colors.accent} />
      </ThemedView>
    );
  }

  if (loadState === 'error' || !client) {
    return (
      <ThemedView style={styles.centerFill}>
        <ThemedText themeColor="textSecondary" style={styles.centerText}>
          Couldn't reach the station.
        </ThemedText>
        <Pressable onPress={load} style={styles.retryButton}>
          <ThemedText themeColor="accent">Try again</ThemedText>
        </Pressable>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {actionError ? (
          <ThemedText type="small" style={{ color: colors.accent }}>
            {actionError}
          </ThemedText>
        ) : null}

        <ThemedText type="smallBold">Scheduled tracks</ThemedText>
        {scheduledMedia.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            Nothing scheduled.
          </ThemedText>
        ) : (
          <View style={styles.list}>
            {scheduledMedia.map((item) => (
              <View key={item.id} style={[styles.row, { backgroundColor: colors.backgroundElement }]}>
                <View style={styles.rowText}>
                  <ThemedText type="smallBold" numberOfLines={1}>
                    {item.title || item.filename}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    Releases {item.release_at}
                  </ThemedText>
                </View>
                <Pressable
                  onPress={() => cancelMediaRelease(item)}
                  disabled={busyKey === `media-${item.id}`}
                  style={styles.cancelButton}>
                  {busyKey === `media-${item.id}` ? (
                    <ActivityIndicator color={colors.accent} size="small" />
                  ) : (
                    <ThemedText type="small" themeColor="accent">
                      Cancel
                    </ThemedText>
                  )}
                </Pressable>
              </View>
            ))}
          </View>
        )}

        <ThemedText type="smallBold" style={styles.sectionLabel}>
          Scheduled posts
        </ThemedText>
        {scheduledPosts.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            Nothing scheduled.
          </ThemedText>
        ) : (
          <View style={styles.list}>
            {scheduledPosts.map((post) => (
              <View key={post.id} style={[styles.row, { backgroundColor: colors.backgroundElement }]}>
                <View style={styles.rowText}>
                  <ThemedText type="smallBold" numberOfLines={1}>
                    {post.title || 'Untitled post'}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    Publishes {post.published_at}
                  </ThemedText>
                </View>
                <Pressable
                  onPress={() => publishPostNow(post)}
                  disabled={busyKey === `post-${post.id}`}
                  style={styles.cancelButton}>
                  {busyKey === `post-${post.id}` ? (
                    <ActivityIndicator color={colors.accent} size="small" />
                  ) : (
                    <ThemedText type="small" themeColor="accent">
                      Publish now
                    </ThemedText>
                  )}
                </Pressable>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scroll: {
    padding: Spacing.three,
    gap: Spacing.two,
  },
  sectionLabel: {
    marginTop: Spacing.two,
  },
  list: {
    gap: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 12,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  cancelButton: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
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
