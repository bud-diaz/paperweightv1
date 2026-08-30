import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useDashboardAuth } from '@/state/dashboardAuthStore';

/**
 * Local sign-out only — clears this phone's stored device token. Full
 * cross-device revocation stays on web Security.tsx's "Authorized Devices"
 * panel, per the scope doc; this screen never lists or revokes other
 * devices.
 */
export function DeviceSettings() {
  const colors = useTheme();
  const router = useRouter();
  const { auth, signOut } = useDashboardAuth();

  async function handleSignOut() {
    await signOut();
    router.replace('/(tabs)/studio');
  }

  if (!auth) return null;

  return (
    <ThemedView style={styles.container}>
      <View style={[styles.card, { backgroundColor: colors.backgroundElement }]}>
        <ThemedText type="small" themeColor="textSecondary">
          Paired station
        </ThemedText>
        <ThemedText type="smallBold">{auth.baseUrl}</ThemedText>

        <ThemedText type="small" themeColor="textSecondary" style={styles.pairedAt}>
          Paired {new Date(auth.pairedAt).toLocaleString()}
        </ThemedText>
      </View>

      <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
        Signing out clears this phone's saved credential. It doesn't revoke access remotely — do
        that from your desktop dashboard's Security → Authorized Devices panel if this phone is
        lost or no longer yours.
      </ThemedText>

      <Pressable
        onPress={handleSignOut}
        style={({ pressed }) => [styles.signOutButton, { backgroundColor: colors.accent, opacity: pressed ? 0.85 : 1 }]}>
        <ThemedText style={styles.signOutLabel}>Sign out this device</ThemedText>
      </Pressable>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
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
  hint: {
    lineHeight: 20,
  },
  signOutButton: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    paddingVertical: Spacing.two,
  },
  signOutLabel: {
    color: '#ffffff',
    fontWeight: '700',
  },
});
