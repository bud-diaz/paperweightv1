import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { createStationClient, type StreamStatus } from '@/api/stationClient';
import { DashboardClientError, type BroadcastQueueItem } from '@/api/dashboardClient';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useDashboardClient, useStudioStore } from '@/state/studioStore';

const STATUS_POLL_MS = 10_000;

/**
 * Ports studio/src/views/Broadcast.tsx's RotationSection — current
 * now-playing track, rotation mode toggle, restart, and the broadcast
 * queue. The live mic/video broadcast-origination flow (Broadcast.tsx's
 * "Go live" button) is out of scope: it would need real-time audio capture
 * from the phone, a substantially bigger feature never called for in the
 * Phase 5 file list.
 */
export function NowPlayingScreen() {
  const colors = useTheme();
  const { studio, signOut } = useStudioStore();
  const dashboard = useDashboardClient();
  const stationClient = useMemo(() => (studio ? createStationClient(studio.baseUrl) : null), [studio]);

  const [status, setStatus] = useState<StreamStatus | null>(null);
  const [queue, setQueue] = useState<BroadcastQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback((message: string) => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    setNotice(message);
    noticeTimerRef.current = setTimeout(() => setNotice(null), 2500);
  }, []);

  const handleAuthError = useCallback(
    (err: unknown) => {
      if (err instanceof DashboardClientError && err.status === 401) {
        signOut();
        return true;
      }
      return false;
    },
    [signOut]
  );

  const loadQueue = useCallback(async () => {
    if (!dashboard) return;
    try {
      const data = await dashboard.broadcastQueue();
      setQueue(data.queue || []);
    } catch (err) {
      handleAuthError(err);
    }
  }, [dashboard, handleAuthError]);

  useEffect(() => {
    if (!stationClient) return;
    let cancelled = false;
    const poll = () => {
      stationClient
        .streamStatus()
        .then((s) => {
          if (!cancelled) {
            setStatus(s);
            setLoading(false);
          }
        })
        .catch(() => {
          if (!cancelled) setLoading(false);
        });
    };
    poll();
    const id = setInterval(poll, STATUS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [stationClient]);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  const toggleMode = useCallback(async () => {
    if (!dashboard || !status) return;
    setPending(true);
    try {
      await dashboard.setBroadcastMode(status.mode === 'shuffle' ? 'scheduled' : 'shuffle');
      notify('Rotation mode updated.');
    } catch (err) {
      if (!handleAuthError(err)) notify('Could not update rotation mode.');
    } finally {
      setPending(false);
    }
  }, [dashboard, status, notify, handleAuthError]);

  const restart = useCallback(async () => {
    if (!dashboard) return;
    setPending(true);
    try {
      await dashboard.restartBroadcast();
      notify('Broadcast restarted.');
    } catch (err) {
      if (!handleAuthError(err)) notify('Could not restart the broadcast.');
    } finally {
      setPending(false);
    }
  }, [dashboard, notify, handleAuthError]);

  const removeFromQueue = useCallback(
    async (idx: number) => {
      if (!dashboard) return;
      try {
        await dashboard.removeFromQueue(idx);
        notify('Removed from queue.');
        loadQueue();
      } catch (err) {
        if (!handleAuthError(err)) notify('Could not remove from queue.');
      }
    },
    [dashboard, notify, handleAuthError, loadQueue]
  );

  const mode = status?.mode || 'shuffle';

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <ThemedText type="subtitle">Station rotation</ThemedText>
        {notice ? (
          <ThemedText type="small" themeColor="accent">
            {notice}
          </ThemedText>
        ) : null}
      </View>
      {loading ? (
        <View style={styles.centerFill}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <View style={styles.body}>
          <View style={[styles.card, { backgroundColor: colors.backgroundElement }]}>
            <ThemedText type="smallBold" numberOfLines={1}>
              {status?.nowPlaying ? status.nowPlaying.title : 'Nothing playing'}
            </ThemedText>
            {status?.nowPlaying?.artist ? (
              <ThemedText type="small" themeColor="textSecondary">
                {status.nowPlaying.artist}
              </ThemedText>
            ) : null}
            <View style={[styles.modeBadge, { backgroundColor: colors.accentSoft }]}>
              <ThemedText type="small" themeColor="accent">
                {mode}
              </ThemedText>
            </View>
            <View style={styles.actionRow}>
              <Pressable
                onPress={toggleMode}
                disabled={pending}
                style={[styles.actionButton, { borderColor: colors.border, opacity: pending ? 0.5 : 1 }]}>
                <ThemedText type="small">Switch to {mode === 'shuffle' ? 'scheduled' : 'shuffle'}</ThemedText>
              </Pressable>
              <Pressable
                onPress={restart}
                disabled={pending}
                style={[styles.actionButton, { borderColor: colors.border, opacity: pending ? 0.5 : 1 }]}>
                <ThemedText type="small">Restart</ThemedText>
              </Pressable>
            </View>
          </View>

          <View style={[styles.card, { backgroundColor: colors.backgroundElement }]}>
            <ThemedText type="small" themeColor="textSecondary">
              Broadcast queue
            </ThemedText>
            {queue.length ? (
              queue.map((item, i) => (
                <View key={`${item.mediaId}-${i}`} style={styles.queueRow}>
                  <ThemedText type="small" numberOfLines={1} style={styles.queueTitle}>
                    {item.title || `Track ${item.mediaId}`}
                  </ThemedText>
                  <Pressable onPress={() => removeFromQueue(i)} hitSlop={8}>
                    <ThemedText type="small" themeColor="accent">
                      Remove
                    </ThemedText>
                  </Pressable>
                </View>
              ))
            ) : (
              <ThemedText type="small" themeColor="textSecondary" style={styles.emptyQueue}>
                Queue is empty.
              </ThemedText>
            )}
          </View>
        </View>
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
    gap: Spacing.one,
  },
  body: {
    padding: Spacing.three,
    gap: Spacing.three,
  },
  card: {
    borderRadius: 14,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  modeBadge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: Spacing.two,
    marginTop: Spacing.one,
  },
  actionRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  actionButton: {
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
  },
  queueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingVertical: Spacing.one,
  },
  queueTitle: {
    flex: 1,
  },
  emptyQueue: {
    paddingVertical: Spacing.one,
  },
  centerFill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
