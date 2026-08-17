import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { DashboardClientError, type DashboardMediaItem } from '@/api/dashboardClient';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useDashboardClient, useStudioStore } from '@/state/studioStore';

type Preset = { label: string; at: () => Date };

const PRESETS: Preset[] = [
  { label: 'In 1 hour', at: () => new Date(Date.now() + 60 * 60 * 1000) },
  {
    label: 'Tonight, 9pm',
    at: () => {
      const d = new Date();
      d.setHours(21, 0, 0, 0);
      if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
      return d;
    },
  },
  {
    label: 'Tomorrow, 9am',
    at: () => {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      return d;
    },
  },
  { label: 'In 3 days', at: () => new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) },
  { label: 'In 1 week', at: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
];

/**
 * Handles two shapes: the server's SQLite datetime ('YYYY-MM-DD HH:MM:SS',
 * space-separated, no zone — what a real GET /api/dashboard/media returns)
 * and a plain ISO string with a zone already on it (what the optimistic
 * local update below stores immediately after a successful PATCH, before
 * any refetch). Blindly appending 'Z' to the latter double-zones it and
 * produces an invalid date — found on real hardware, not by inspection.
 */
function formatReleaseAt(value: string): string {
  const hasZone = /[zZ]$|[+-]\d\d:\d\d$/.test(value);
  const date = new Date(hasZone ? value : `${value.replace(' ', 'T')}Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/**
 * v1 scope, chosen after confirming no release-scheduling UI exists
 * anywhere in web Studio to port (only the backend's media.release_at
 * auto-publish mechanism does): a minimal list of non-public catalog tracks
 * with quick-pick relative presets to set/clear release_at, via the
 * existing PATCH /api/dashboard/media/:id endpoint. No new backend work,
 * no date-picker native dependency — presets cover the realistic "schedule
 * a drop" use case without needing minute-level precision.
 */
export function ReleaseSchedulingScreen() {
  const colors = useTheme();
  const { signOut } = useStudioStore();
  const dashboard = useDashboardClient();

  const [items, setItems] = useState<DashboardMediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback((message: string) => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    setNotice(message);
    noticeTimerRef.current = setTimeout(() => setNotice(null), 2500);
  }, []);

  const load = useCallback(() => {
    if (!dashboard) return;
    dashboard
      .mediaList()
      .then((list) => setItems(list.filter((item) => item.visibility !== 'public')))
      .catch((err) => {
        if (err instanceof DashboardClientError && err.status === 401) signOut();
      })
      .finally(() => setLoading(false));
  }, [dashboard, signOut]);

  useEffect(() => {
    load();
  }, [load]);

  const applyReleaseAt = useCallback(
    async (id: number, releaseAt: string | null) => {
      if (!dashboard) return;
      setPendingId(id);
      try {
        await dashboard.updateMediaReleaseAt(id, releaseAt);
        setItems((prev) => prev.map((item) => (item.id === id ? { ...item, release_at: releaseAt } : item)));
        notify(releaseAt ? 'Release scheduled.' : 'Schedule cleared.');
        setExpandedId(null);
      } catch (err) {
        if (err instanceof DashboardClientError) {
          if (err.status === 401) {
            signOut();
            return;
          }
          const data = err.data as { error?: string };
          notify(data?.error || 'Could not update the schedule.');
        } else {
          notify('Could not update the schedule — connection error.');
        }
      } finally {
        setPendingId(null);
      }
    },
    [dashboard, notify, signOut]
  );

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <ThemedText type="subtitle">Release scheduling</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Non-public tracks only — set a time to auto-publish, or clear an existing schedule.
        </ThemedText>
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
      ) : items.length === 0 ? (
        <View style={styles.centerFill}>
          <ThemedText themeColor="textSecondary" style={styles.centerText}>
            Every track is already public — nothing to schedule.
          </ThemedText>
        </View>
      ) : (
        <View style={styles.list}>
          {items.map((item) => {
            const expanded = expandedId === item.id;
            const pending = pendingId === item.id;
            return (
              <View key={item.id} style={[styles.row, { backgroundColor: colors.backgroundElement }]}>
                <Pressable
                  onPress={() => setExpandedId(expanded ? null : item.id)}
                  style={styles.rowHead}>
                  <View style={styles.rowInfo}>
                    <ThemedText type="smallBold" numberOfLines={1}>
                      {item.title || item.filename}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {item.visibility}
                      {item.release_at ? ` · Releases ${formatReleaseAt(item.release_at)}` : ' · Not scheduled'}
                    </ThemedText>
                  </View>
                </Pressable>
                {expanded ? (
                  <View style={styles.presetRow}>
                    {PRESETS.map((preset) => (
                      <Pressable
                        key={preset.label}
                        disabled={pending}
                        onPress={() => applyReleaseAt(item.id, preset.at().toISOString())}
                        style={[styles.presetChip, { borderColor: colors.border, opacity: pending ? 0.5 : 1 }]}>
                        <ThemedText type="small">{preset.label}</ThemedText>
                      </Pressable>
                    ))}
                    {item.release_at ? (
                      <Pressable
                        disabled={pending}
                        onPress={() => applyReleaseAt(item.id, null)}
                        style={[styles.presetChip, { borderColor: colors.accent, opacity: pending ? 0.5 : 1 }]}>
                        <ThemedText type="small" themeColor="accent">
                          Clear schedule
                        </ThemedText>
                      </Pressable>
                    ) : null}
                    {pending ? <ActivityIndicator color={colors.accent} size="small" /> : null}
                  </View>
                ) : null}
              </View>
            );
          })}
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
  list: {
    padding: Spacing.three,
    gap: Spacing.two,
  },
  row: {
    borderRadius: 14,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  rowHead: {
    gap: 2,
  },
  rowInfo: {
    gap: 2,
  },
  presetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.one,
  },
  presetChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
  },
  centerFill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
  },
  centerText: {
    textAlign: 'center',
  },
});
