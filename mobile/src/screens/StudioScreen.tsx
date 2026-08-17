import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { StudioGate } from '@/screens/StudioGate';
import { DeviceSettingsScreen } from '@/screens/studio/DeviceSettingsScreen';
import { NotificationsScreen } from '@/screens/studio/NotificationsScreen';
import { NowPlayingScreen } from '@/screens/studio/NowPlayingScreen';
import { QuickStatsScreen } from '@/screens/studio/QuickStatsScreen';
import { ReleaseSchedulingScreen } from '@/screens/studio/ReleaseSchedulingScreen';
import { useStudioStore } from '@/state/studioStore';

type Section = 'menu' | 'now-playing' | 'quick-stats' | 'release-scheduling' | 'notifications' | 'device';

const MENU_ITEMS: { section: Section; icon: keyof typeof Ionicons.glyphMap; label: string; description: string }[] = [
  { section: 'now-playing', icon: 'radio-outline', label: 'Now playing', description: 'Rotation mode, restart, broadcast queue' },
  { section: 'quick-stats', icon: 'stats-chart-outline', label: 'Quick stats', description: 'Listeners, revenue, recent activity' },
  { section: 'release-scheduling', icon: 'time-outline', label: 'Release scheduling', description: 'Schedule non-public tracks to auto-publish' },
  { section: 'notifications', icon: 'notifications-outline', label: 'Notifications', description: 'Go-live webhook settings' },
  { section: 'device', icon: 'phone-portrait-outline', label: 'Device', description: 'This phone’s pairing' },
];

/**
 * Top-level Studio tab: branches unpaired (StudioGate) vs. paired
 * (a simple menu → detail-screen pattern using local state rather than
 * expo-router sub-routes, to avoid any path ambiguity with the tab's own
 * `/studio` route). Android hardware back returns to the menu instead of
 * exiting the tab, matching what a native back-gesture would do.
 */
export function StudioScreen() {
  const colors = useTheme();
  const { hydrated, studio } = useStudioStore();
  const [section, setSection] = useState<Section>('menu');

  useEffect(() => {
    if (section === 'menu') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setSection('menu');
      return true;
    });
    return () => sub.remove();
  }, [section]);

  if (!hydrated) return <ThemedView style={styles.container} />;
  if (!studio) return <StudioGate />;

  if (section !== 'menu') {
    const screen =
      section === 'now-playing' ? (
        <NowPlayingScreen />
      ) : section === 'quick-stats' ? (
        <QuickStatsScreen />
      ) : section === 'release-scheduling' ? (
        <ReleaseSchedulingScreen />
      ) : section === 'notifications' ? (
        <NotificationsScreen />
      ) : (
        <DeviceSettingsScreen />
      );
    return (
      <ThemedView style={styles.container}>
        <Pressable onPress={() => setSection('menu')} style={styles.backRow} hitSlop={8}>
          <Ionicons name="chevron-back" size={20} color={colors.text} />
          <ThemedText type="small">Studio</ThemedText>
        </Pressable>
        {screen}
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <ThemedText type="title" style={styles.title}>
          Studio
        </ThemedText>
        <ThemedText themeColor="textSecondary">{studio.baseUrl}</ThemedText>
      </View>
      <View style={styles.list}>
        {MENU_ITEMS.map((item) => (
          <Pressable
            key={item.section}
            onPress={() => setSection(item.section)}
            style={[styles.row, { backgroundColor: colors.backgroundElement }]}>
            <View style={[styles.rowIcon, { backgroundColor: colors.accentSoft }]}>
              <Ionicons name={item.icon} size={18} color={colors.accent} />
            </View>
            <View style={styles.rowInfo}>
              <ThemedText type="smallBold">{item.label}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {item.description}
              </ThemedText>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
          </Pressable>
        ))}
      </View>
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
  title: {
    fontSize: 32,
    lineHeight: 38,
  },
  list: {
    padding: Spacing.three,
    gap: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: 14,
    padding: Spacing.three,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowInfo: {
    flex: 1,
    gap: 2,
  },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.one,
  },
});
