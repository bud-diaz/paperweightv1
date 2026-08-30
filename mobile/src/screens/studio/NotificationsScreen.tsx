import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { DashboardClientError, type NotifyLogEvent } from '@/api/dashboardClient';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useDashboardClient } from '@/state/dashboardAuthStore';

type LoadState = 'loading' | 'ready' | 'error';

const CONTEXT_LABELS: Record<string, string> = {
  'go-live': 'Went live',
  'go-live-video': 'Went live (video)',
  post: 'New post',
  'media-release': 'Track released',
  'release-campaign': 'Release published',
};

const STATUS_LABELS: Record<NotifyLogEvent['status'], string> = {
  sent: 'Sent',
  failed: 'Failed',
  skipped: 'Skipped',
};

export function NotificationsScreen() {
  const colors = useTheme();
  const router = useRouter();
  const client = useDashboardClient();

  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [events, setEvents] = useState<NotifyLogEvent[]>([]);

  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    if (!client) return;
    const requestId = ++requestIdRef.current;
    setLoadState('loading');
    try {
      const result = await client.notifyLog(50);
      if (requestId !== requestIdRef.current) return;
      setEvents(result.events);
      setLoadState('ready');
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      if (err instanceof DashboardClientError && err.status === 401) {
        router.replace('/(tabs)/studio');
        return;
      }
      setLoadState('error');
    }
  }, [client, router]);

  useEffect(() => {
    load();
  }, [load]);

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

  if (events.length === 0) {
    return (
      <ThemedView style={styles.centerFill}>
        <ThemedText themeColor="textSecondary" style={styles.centerText}>
          Nothing fired yet — go-live, post, and release announcements will show up here once your
          webhook is configured and something happens.
        </ThemedText>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.list}>
        {events.map((event) => {
          const statusColor =
            event.status === 'sent' ? colors.live : event.status === 'failed' ? colors.accent : colors.textSecondary;
          return (
            <View key={event.id} style={[styles.row, { backgroundColor: colors.backgroundElement }]}>
              <View style={styles.rowTop}>
                <ThemedText type="smallBold">{CONTEXT_LABELS[event.context] || event.context}</ThemedText>
                <View style={[styles.statusPill, { backgroundColor: colors.backgroundSelected }]}>
                  <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
                  <ThemedText type="small" style={{ color: statusColor }}>
                    {STATUS_LABELS[event.status]}
                  </ThemedText>
                </View>
              </View>
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
                {event.content}
              </ThemedText>
              {event.error_msg ? (
                <ThemedText type="small" style={{ color: colors.accent }} numberOfLines={2}>
                  {event.error_msg}
                </ThemedText>
              ) : null}
              <ThemedText type="small" themeColor="textSecondary">
                {event.created_at}
              </ThemedText>
            </View>
          );
        })}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  list: {
    padding: Spacing.three,
    gap: Spacing.two,
  },
  row: {
    borderRadius: 12,
    padding: Spacing.three,
    gap: Spacing.half,
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    paddingVertical: 2,
    paddingHorizontal: Spacing.two,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
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
