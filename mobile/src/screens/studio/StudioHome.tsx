import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useDashboardAuth } from '@/state/dashboardAuthStore';

const MENU: { href: '/studio/now-playing' | '/studio/quick-stats' | '/studio/upload' | '/studio/release-scheduling' | '/studio/notifications' | '/studio/device'; icon: keyof typeof Ionicons.glyphMap; title: string; subtitle: string }[] = [
  { href: '/studio/now-playing', icon: 'radio-outline', title: 'Now Playing', subtitle: 'Live status, broadcast controls, up-next queue' },
  { href: '/studio/quick-stats', icon: 'stats-chart-outline', title: 'Quick Stats', subtitle: 'Listeners, earnings, recent activity' },
  { href: '/studio/upload', icon: 'cloud-upload-outline', title: 'Upload Media', subtitle: 'Send audio/video from this phone to your vault' },
  { href: '/studio/release-scheduling', icon: 'calendar-outline', title: 'Release Scheduling', subtitle: 'Scheduled tracks and posts' },
  { href: '/studio/notifications', icon: 'notifications-outline', title: 'Notifications', subtitle: 'Recent go-live/post/release webhook activity' },
  { href: '/studio/device', icon: 'phone-portrait-outline', title: 'Device', subtitle: 'This phone’s pairing' },
];

export function StudioHome() {
  const colors = useTheme();
  const router = useRouter();
  const { auth } = useDashboardAuth();

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <ThemedText type="title" style={styles.title}>
          Studio
        </ThemedText>
        {auth ? (
          <View style={[styles.stationStrip, { backgroundColor: colors.backgroundElement, borderColor: colors.border }]}>
            <ThemedText type="small" themeColor="textSecondary">
              Paired station
            </ThemedText>
            <ThemedText type="smallBold" numberOfLines={1}>
              {auth.baseUrl}
            </ThemedText>
          </View>
        ) : null}
      </View>

      <View style={styles.list}>
        {MENU.map((item) => (
          <Pressable
            key={item.href}
            onPress={() => router.push(item.href as never)}
            style={({ pressed }) => [
              styles.row,
              { backgroundColor: colors.backgroundElement, opacity: pressed ? 0.8 : 1 },
            ]}>
            <View style={[styles.rowIcon, { backgroundColor: colors.backgroundSelected }]}>
              <Ionicons name={item.icon} size={20} color={colors.text} />
            </View>
            <View style={styles.rowText}>
              <ThemedText type="smallBold">{item.title}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                {item.subtitle}
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
    gap: Spacing.two,
  },
  title: {
    fontSize: 32,
    lineHeight: 38,
  },
  stationStrip: {
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    gap: 2,
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
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
});
