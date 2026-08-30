import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Unpaired Studio state. This is an optional, creator-only feature gated on
 * an external desktop session — the copy here deliberately frames it that
 * way (not a dead-end core tab) since most first-time or listener-only
 * users will never pair anything, and an app-store reviewer can't perform
 * the desktop pairing step either.
 */
export function StudioGate() {
  const colors = useTheme();
  const router = useRouter();

  return (
    <ThemedView style={styles.container}>
      <View style={[styles.iconWrap, { backgroundColor: colors.backgroundElement }]}>
        <Ionicons name="qr-code-outline" size={40} color={colors.textSecondary} />
      </View>

      <ThemedText type="title" style={styles.title}>
        Studio
      </ThemedText>

      <ThemedText type="default" themeColor="textSecondary" style={styles.body}>
        Studio is an optional remote for creators — it controls your own station's live broadcast,
        stats, scheduling, and notifications from your phone.
      </ThemedText>

      <ThemedText type="small" themeColor="textSecondary" style={styles.body}>
        To use it, sign in to your station's desktop dashboard first, then pair this phone from its
        Security settings — a QR code will appear there for you to scan below.
      </ThemedText>

      <Pressable
        onPress={() => router.push('/studio-pair')}
        style={({ pressed }) => [styles.button, { backgroundColor: colors.accent, opacity: pressed ? 0.85 : 1 }]}>
        <Ionicons name="qr-code" size={18} color="#fff" />
        <ThemedText style={styles.buttonLabel}>Scan QR to pair</ThemedText>
      </Pressable>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.two,
  },
  title: {
    fontSize: 32,
    lineHeight: 38,
  },
  body: {
    textAlign: 'center',
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    borderRadius: 999,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.four,
    marginTop: Spacing.three,
  },
  buttonLabel: {
    color: '#ffffff',
    fontWeight: '700',
  },
});
