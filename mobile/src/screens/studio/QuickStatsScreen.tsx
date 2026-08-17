import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { createStationClient, type StreamStatus } from '@/api/stationClient';
import { DashboardClientError, type ActivityItem, type EarningsTotals, type HistoryDay } from '@/api/dashboardClient';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useDashboardClient, useStudioStore } from '@/state/studioStore';

function formatCents(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

function weekLabel(day?: HistoryDay): string {
  if (!day) return '';
  return new Date(day.date).toLocaleDateString(undefined, { month: 'short', day: '2-digit' });
}

/**
 * Ports the Metric-cards + weekly pulse chart + recent-activity sections of
 * studio/src/views/Overview.tsx. Swaps "Catalog size" for "Active
 * subscribers" (already in the earnings response) rather than adding a
 * separate /api/library/structure fetch just for one number.
 */
export function QuickStatsScreen() {
  const colors = useTheme();
  const { studio, signOut } = useStudioStore();
  const dashboard = useDashboardClient();
  const stationClient = useMemo(() => (studio ? createStationClient(studio.baseUrl) : null), [studio]);

  const [status, setStatus] = useState<StreamStatus | null>(null);
  const [earnings, setEarnings] = useState<EarningsTotals | null>(null);
  const [history, setHistory] = useState<HistoryDay[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!dashboard) return;
    let cancelled = false;
    Promise.all([dashboard.earnings(), dashboard.analyticsHistory(30), dashboard.analyticsActivity(5)])
      .then(([earningsData, historyData, activityData]) => {
        if (cancelled) return;
        setEarnings(earningsData);
        setHistory(historyData);
        setActivity(activityData);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof DashboardClientError && err.status === 401) signOut();
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dashboard, signOut]);

  useEffect(() => {
    if (!stationClient) return;
    let cancelled = false;
    stationClient
      .streamStatus()
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [stationClient]);

  const listeningHours = history.reduce((sum, day) => sum + (day.total_listen_sec || 0), 0) / 3600;
  const weekHistory = history.slice(-14);
  const weekMax = Math.max(1, ...weekHistory.map((day) => day.unique_listeners || 0));

  const activityIcon: Record<ActivityItem['type'], string> = { tip: '$', unlock: '\u{1F512}', subscription: '★' };

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <ThemedText type="subtitle">Quick stats</ThemedText>
      </View>
      {loading ? (
        <View style={styles.centerFill}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <View style={styles.body}>
          <View style={styles.metricGrid}>
            <View style={[styles.metric, { backgroundColor: colors.backgroundElement }]}>
              <ThemedText type="small" themeColor="textSecondary">
                Listeners now
              </ThemedText>
              <ThemedText type="subtitle" style={styles.metricValue}>
                {status?.listenerCount ?? 0}
              </ThemedText>
            </View>
            <View style={[styles.metric, { backgroundColor: colors.backgroundElement }]}>
              <ThemedText type="small" themeColor="textSecondary">
                This month
              </ThemedText>
              <ThemedText type="subtitle" style={styles.metricValue}>
                {formatCents(earnings?.monthRevenueCents ?? 0)}
              </ThemedText>
            </View>
            <View style={[styles.metric, { backgroundColor: colors.backgroundElement }]}>
              <ThemedText type="small" themeColor="textSecondary">
                Listening hours
              </ThemedText>
              <ThemedText type="subtitle" style={styles.metricValue}>
                {listeningHours.toFixed(1)}h
              </ThemedText>
            </View>
            <View style={[styles.metric, { backgroundColor: colors.backgroundElement }]}>
              <ThemedText type="small" themeColor="textSecondary">
                Active subscribers
              </ThemedText>
              <ThemedText type="subtitle" style={styles.metricValue}>
                {earnings?.activeSubscriptions ?? 0}
              </ThemedText>
            </View>
          </View>

          <View style={[styles.card, { backgroundColor: colors.backgroundElement }]}>
            <ThemedText type="small" themeColor="textSecondary">
              Audience, this week
            </ThemedText>
            {weekHistory.length ? (
              <>
                <View style={styles.chart}>
                  {weekHistory.map((day) => (
                    <View
                      key={day.date}
                      style={[
                        styles.chartBar,
                        {
                          height: `${Math.max(8, Math.round(((day.unique_listeners || 0) / weekMax) * 100))}%`,
                          backgroundColor: colors.accent,
                        },
                      ]}
                    />
                  ))}
                </View>
                <View style={styles.chartLabels}>
                  <ThemedText type="small" themeColor="textSecondary">
                    {weekLabel(weekHistory[0])}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {weekLabel(weekHistory[weekHistory.length - 1])}
                  </ThemedText>
                </View>
              </>
            ) : (
              <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
                No listening activity yet.
              </ThemedText>
            )}
          </View>

          <View style={[styles.card, { backgroundColor: colors.backgroundElement }]}>
            <ThemedText type="small" themeColor="textSecondary">
              Recent activity
            </ThemedText>
            {activity.length ? (
              activity.map((item, i) => (
                <View key={`${item.type}-${item.occurred_at}-${i}`} style={styles.activityRow}>
                  <ThemedText style={styles.activityIcon}>{activityIcon[item.type]}</ThemedText>
                  <View style={styles.activityInfo}>
                    <ThemedText type="small" numberOfLines={1}>
                      {item.title}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {item.detail}
                    </ThemedText>
                  </View>
                </View>
              ))
            ) : (
              <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
                Nothing to show yet.
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
  },
  body: {
    padding: Spacing.three,
    gap: Spacing.three,
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  metric: {
    flexBasis: '47%',
    flexGrow: 1,
    borderRadius: 14,
    padding: Spacing.two,
    gap: 2,
  },
  metricValue: {
    fontSize: 22,
    lineHeight: 28,
  },
  card: {
    borderRadius: 14,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  chart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 4,
    height: 100,
  },
  chartBar: {
    flex: 1,
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
  },
  chartLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.one,
  },
  activityIcon: {
    width: 24,
    textAlign: 'center',
  },
  activityInfo: {
    flex: 1,
    gap: 2,
  },
  emptyText: {
    paddingVertical: Spacing.one,
  },
  centerFill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
