import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { DashboardClientError, type BroadcastQueueItem, type DashboardMediaItem, type LiveState } from '@/api/dashboardClient';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { ScheduleBlock } from '@/api/dashboardClient';
import type { StreamStatus } from '@/player/types';
import { useDashboardClient } from '@/state/dashboardAuthStore';

type LoadState = 'loading' | 'ready' | 'error';

export function NowPlayingScreen() {
  const colors = useTheme();
  const router = useRouter();
  const client = useDashboardClient();

  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [status, setStatus] = useState<StreamStatus | null>(null);
  const [live, setLive] = useState<LiveState | null>(null);
  const [schedule, setSchedule] = useState<ScheduleBlock | null>(null);
  const [queue, setQueue] = useState<BroadcastQueueItem[]>([]);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const [pickerItems, setPickerItems] = useState<DashboardMediaItem[]>([]);
  const [pickerLoadState, setPickerLoadState] = useState<LoadState>('loading');

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
      const [statusRes, liveRes, scheduleRes, queueRes] = await Promise.all([
        client.streamStatus(),
        client.liveStatus(),
        client.scheduleCurrent(),
        client.broadcastQueue(),
      ]);
      if (requestId !== requestIdRef.current) return;
      setStatus(statusRes);
      setLive(liveRes);
      setSchedule(scheduleRes);
      setQueue(queueRes.queue);
      setLoadState('ready');
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      if (!handleAuthError(err)) setLoadState('error');
    }
  }, [client, handleAuthError]);

  useEffect(() => {
    load();
  }, [load]);

  async function runAction(key: string, fn: () => Promise<unknown>) {
    if (!client) return;
    setActionBusy(key);
    setActionError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      if (!handleAuthError(err)) setActionError('That action failed — try again.');
    } finally {
      setActionBusy(null);
    }
  }

  async function removeQueued(idx: number) {
    await runAction(`dequeue-${idx}`, () => client!.dequeueTrack(idx));
  }

  async function openPicker() {
    setPickerOpen(true);
    setPickerQuery('');
    if (!client) return;
    setPickerLoadState('loading');
    try {
      const items = await client.mediaList();
      setPickerItems(items.filter((item) => item.visibility === 'public'));
      setPickerLoadState('ready');
    } catch (err) {
      if (!handleAuthError(err)) setPickerLoadState('error');
    }
  }

  async function addTrack(item: DashboardMediaItem) {
    await runAction(`queue-${item.id}`, async () => {
      const result = await client!.queueTrack(item.id);
      if (!result.ok) throw new Error(result.error || 'Could not queue track');
    });
    setPickerOpen(false);
  }

  const filteredPickerItems = pickerQuery.trim()
    ? pickerItems.filter((item) => {
        const q = pickerQuery.trim().toLowerCase();
        return (item.title || item.filename).toLowerCase().includes(q) || (item.artist || '').toLowerCase().includes(q);
      })
    : pickerItems;

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
        <View style={[styles.card, { backgroundColor: colors.backgroundElement }]}>
          <View style={styles.cardTopRow}>
            <ThemedText type="smallBold">Now playing</ThemedText>
            {status?.liveActive || live?.isLive ? (
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
          <ThemedText type="default" numberOfLines={2}>
            {status?.nowPlaying?.title || 'Nothing playing'}
          </ThemedText>
          {status?.nowPlaying?.artist ? (
            <ThemedText type="small" themeColor="textSecondary">
              {status.nowPlaying.artist}
            </ThemedText>
          ) : null}
          <ThemedText type="small" themeColor="textSecondary">
            {status?.listenerCount ?? 0} listening · mode: {status?.mode ?? 'shuffle'}
          </ThemedText>
          {schedule ? (
            <ThemedText type="small" themeColor="textSecondary">
              Current schedule block: {schedule.start_time}–{schedule.end_time}
              {schedule.category ? ` · ${schedule.category}` : ''}
            </ThemedText>
          ) : null}
        </View>

        {actionError ? (
          <ThemedText type="small" style={{ color: colors.accent }}>
            {actionError}
          </ThemedText>
        ) : null}

        <View style={styles.controlsRow}>
          <ActionButton
            label="Restart"
            busy={actionBusy === 'restart'}
            onPress={() => runAction('restart', () => client.broadcastRestart())}
            colors={colors}
          />
          <ActionButton
            label="Stop"
            busy={actionBusy === 'stop'}
            onPress={() => runAction('stop', () => client.broadcastStop())}
            colors={colors}
          />
          <ActionButton
            label={status?.mode === 'scheduled' ? 'Use shuffle' : 'Use scheduled'}
            busy={actionBusy === 'mode'}
            onPress={() => runAction('mode', () => client.broadcastMode(status?.mode === 'scheduled' ? 'shuffle' : 'scheduled'))}
            colors={colors}
          />
        </View>

        <View style={styles.sectionHeader}>
          <ThemedText type="smallBold">Up next</ThemedText>
          <Pressable onPress={openPicker} style={({ pressed }) => [styles.addButton, { opacity: pressed ? 0.7 : 1 }]}>
            <Ionicons name="add-circle-outline" size={18} color={colors.accent} />
            <ThemedText type="smallBold" themeColor="accent">
              Add track
            </ThemedText>
          </Pressable>
        </View>

        {queue.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            Nothing queued — the broadcast is picking tracks on its own.
          </ThemedText>
        ) : (
          <View style={styles.list}>
            {queue.map((item, idx) => (
              <View key={`${item.id}-${idx}`} style={[styles.queueRow, { backgroundColor: colors.backgroundElement }]}>
                <View style={styles.rowText}>
                  <ThemedText type="smallBold" numberOfLines={1}>
                    {item.title}
                  </ThemedText>
                  {item.artist ? (
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                      {item.artist}
                    </ThemedText>
                  ) : null}
                </View>
                <Pressable onPress={() => removeQueued(idx)} hitSlop={8} disabled={actionBusy === `dequeue-${idx}`}>
                  {actionBusy === `dequeue-${idx}` ? (
                    <ActivityIndicator color={colors.accent} size="small" />
                  ) : (
                    <Ionicons name="close-circle-outline" size={20} color={colors.textSecondary} />
                  )}
                </Pressable>
              </View>
            ))}
          </View>
        )}

        {pickerOpen ? (
          <View style={[styles.pickerCard, { backgroundColor: colors.backgroundElement, borderColor: colors.border }]}>
            <View style={styles.sectionHeader}>
              <ThemedText type="smallBold">Add a track</ThemedText>
              <Pressable onPress={() => setPickerOpen(false)} hitSlop={8}>
                <Ionicons name="close" size={18} color={colors.textSecondary} />
              </Pressable>
            </View>
            <TextInput
              value={pickerQuery}
              onChangeText={setPickerQuery}
              placeholder="Search public tracks"
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.pickerInput, { backgroundColor: colors.backgroundSelected, color: colors.text }]}
            />
            {pickerLoadState === 'loading' ? (
              <ActivityIndicator color={colors.accent} style={styles.pickerLoading} />
            ) : pickerLoadState === 'error' ? (
              <ThemedText type="small" themeColor="textSecondary">
                Couldn't load the catalog.
              </ThemedText>
            ) : filteredPickerItems.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                No public tracks match.
              </ThemedText>
            ) : (
              <View style={styles.list}>
                {filteredPickerItems.slice(0, 30).map((item) => (
                  <Pressable
                    key={item.id}
                    onPress={() => addTrack(item)}
                    disabled={actionBusy === `queue-${item.id}`}
                    style={({ pressed }) => [
                      styles.pickerRow,
                      { backgroundColor: colors.backgroundSelected, opacity: pressed ? 0.8 : 1 },
                    ]}>
                    <View style={styles.rowText}>
                      <ThemedText type="smallBold" numberOfLines={1}>
                        {item.title || item.filename}
                      </ThemedText>
                      {item.artist ? (
                        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                          {item.artist}
                        </ThemedText>
                      ) : null}
                    </View>
                    {actionBusy === `queue-${item.id}` ? (
                      <ActivityIndicator color={colors.accent} size="small" />
                    ) : (
                      <Ionicons name="add" size={18} color={colors.accent} />
                    )}
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        ) : null}
      </ScrollView>
    </ThemedView>
  );
}

function ActionButton({
  label,
  busy,
  onPress,
  colors,
}: {
  label: string;
  busy: boolean;
  onPress: () => void;
  colors: ReturnType<typeof useTheme>;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      style={({ pressed }) => [
        styles.actionButton,
        { backgroundColor: colors.backgroundSelected, opacity: pressed || busy ? 0.7 : 1 },
      ]}>
      {busy ? <ActivityIndicator color={colors.text} size="small" /> : <ThemedText type="smallBold">{label}</ThemedText>}
    </Pressable>
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
  card: {
    borderRadius: 14,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
  controlsRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  actionButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    paddingVertical: Spacing.two,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  list: {
    gap: Spacing.two,
  },
  queueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 12,
    padding: Spacing.two,
    gap: Spacing.two,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  pickerCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  pickerInput: {
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 16,
  },
  pickerLoading: {
    marginVertical: Spacing.two,
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 12,
    padding: Spacing.two,
    gap: Spacing.two,
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
