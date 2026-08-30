import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import {
  DashboardClientError,
  type AnalyticsActivityEntry,
  type AnalyticsHistoryRow,
  type AnalyticsLive,
  type Earnings,
} from '@/api/dashboardClient';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useDashboardClient } from '@/state/dashboardAuthStore';

type LoadState = 'loading' | 'ready' | 'error';

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatHours(totalSeconds: number): string {
  return (totalSeconds / 3600).toFixed(1);
}

export function QuickStatsScreen() {
  const colors = useTheme();
  const router = useRouter();
  const client = useDashboardClient();

  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [live, setLive] = useState<AnalyticsLive | null>(null);
  const [history, setHistory] = useState<AnalyticsHistoryRow[]>([]);
  const [activity, setActivity] = useState<AnalyticsActivityEntry[]>([]);
  const [earnings, setEarnings] = useState<Earnings | null>(null);

  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    if (!client) return;
    const requestId = ++requestIdRef.current;
    setLoadState('loading');
    try {
      const [liveRes, historyRes, activityRes, earningsRes] = await Promise.all([
        client.analyticsLive(),
        client.analyticsHistory(30),
        client.analyticsActivity(10),
        client.earnings(),
      ]);
      if (requestId !== requestIdRef.current) return;
      setLive(liveRes);
      setHistory(historyRes);
      setActivity(activityRes);
      setEarnings(earningsRes);
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

  const thirtyDayListeners = history.reduce((sum, row) => sum + row.unique_listeners, 0);
  const thirtyDayHours = history.reduce((sum, row) => sum + row.total_listen_sec, 0);
  const allTimeRevenue = (earnings?.unlocks || []).reduce((sum, row) => sum + row.revenueCents, 0);
  const todayRevenue = (earnings?.todayUnlocks || []).reduce((sum, row) => sum + row.revenueCents, 0);

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.tileRow}>
          <StatTile label="Listening now" value={String(live?.currentListeners ?? 0)} colors={colors} />
          <StatTile label="Peak today" value={String(live?.peakToday ?? 0)} colors={colors} />
        </View>
        <View style={styles.tileRow}>
          <StatTile label="30-day listeners" value={String(thirtyDayListeners)} colors={colors} />
          <StatTile label="30-day hours" value={formatHours(thirtyDayHours)} colors={colors} />
        </View>
        <View style={styles.tileRow}>
          <StatTile label="Vault revenue (today)" value={formatCents(todayRevenue)} colors={colors} />
          <StatTile label="Vault revenue (all-time)" value={formatCents(allTimeRevenue)} colors={colors} />
        </View>

        <ThemedText type="smallBold" style={styles.sectionLabel}>
          Recent activity
        </ThemedText>
        {activity.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            Nothing yet.
          </ThemedText>
        ) : (
          <View style={styles.list}>
            {activity.map((entry, idx) => (
              <View key={`${entry.type}-${idx}`} style={[styles.activityRow, { backgroundColor: colors.backgroundElement }]}>
                <View style={styles.rowText}>
                  <ThemedText type="smallBold" numberOfLines={1}>
                    {entry.title}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                    {entry.detail}
                  </ThemedText>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </ThemedView>
  );
}

function StatTile({ label, value, colors }: { label: string; value: string; colors: ReturnType<typeof useTheme> }) {
  return (
    <View style={[styles.tile, { backgroundColor: colors.backgroundElement }]}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="title" style={styles.tileValue}>
        {value}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scroll: {
    padding: Spacing.three,
    gap: Spacing.three,
  },
  tileRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  tile: {
    flex: 1,
    borderRadius: 14,
    padding: Spacing.three,
    gap: 2,
  },
  tileValue: {
    fontSize: 24,
    lineHeight: 28,
  },
  sectionLabel: {
    marginTop: Spacing.one,
  },
  list: {
    gap: Spacing.two,
  },
  activityRow: {
    borderRadius: 12,
    padding: Spacing.two,
  },
  rowText: {
    gap: 2,
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
