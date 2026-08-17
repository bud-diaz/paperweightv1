import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useStudioStore } from '@/state/studioStore';

/**
 * "Sign out this device" clears only the local secure-store credential —
 * actual per-device revocation stays in web Security.tsx's Authorized
 * Devices panel, per the Phase 5 plan. No separate mobile revocation UI.
 */
export function DeviceSettingsScreen() {
  const colors = useTheme();
  const { studio, signOut } = useStudioStore();

  if (!studio) return null;

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <ThemedText type="subtitle">Device</ThemedText>
      </View>
      <View style={styles.body}>
        <View style={[styles.card, { backgroundColor: colors.backgroundElement }]}>
          <ThemedText type="small" themeColor="textSecondary">
            Paired station
          </ThemedText>
          <ThemedText type="smallBold" numberOfLines={1}>
            {studio.baseUrl}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.pairedAt}>
            Paired {new Date(studio.pairedAt).toLocaleDateString()} as {studio.deviceLabel}
          </ThemedText>
        </View>
        <ThemedText type="small" themeColor="textSecondary" style={styles.note}>
          Signing out only removes the credential stored on this phone. To revoke it from the
          server so it can no longer be used at all, use Studio on desktop → Security → Authorized
          Devices.
        </ThemedText>
        <Pressable onPress={signOut} style={[styles.signOutButton, { borderColor: colors.border }]}>
          <ThemedText type="smallBold" themeColor="accent">
            Sign out this device
          </ThemedText>
        </Pressable>
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
  },
  body: {
    padding: Spacing.three,
    gap: Spacing.three,
  },
  card: {
    borderRadius: 14,
    padding: Spacing.three,
    gap: 2,
  },
  pairedAt: {
    marginTop: Spacing.one,
  },
  note: {
    lineHeight: 18,
  },
  signOutButton: {
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: Spacing.two,
    alignItems: 'center',
  },
});
