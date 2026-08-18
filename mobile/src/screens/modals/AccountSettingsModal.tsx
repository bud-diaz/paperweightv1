import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { StationClientError, type ListenerMe } from '@/api/stationClient';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useStationClient, useStationStore } from '@/state/stationStore';

/**
 * Read-focused account view for the currently selected station — email
 * verification status, tier, and access-provider ("tipping identity" per
 * the plan: whether current access came from a tip vs. a subscription).
 * Login/registration itself stays owned by Phase 2's ListenerLoginScreen;
 * this only covers a device that's already authenticated. Deliberately
 * ports a narrower slice of web Studio's `AccountModal.tsx` logged-in
 * branch than the full thing — marketing-opt-in toggle, billing portal,
 * cancel-subscription, delete-account/profile, and data export are all
 * real, separate destructive/complex actions the plan's scope description
 * ("email verification status, supporter tier, tipping identity") doesn't
 * name; each would need its own careful mobile UX (native confirm/prompt
 * equivalents) rather than a silent port of `window.confirm`/`window.
 * prompt`, so left for a deliberate follow-up instead of guessed here.
 */
export function AccountSettingsModal() {
  const colors = useTheme();
  const router = useRouter();
  const { station, listenerAuth, setListenerAuth } = useStationStore();
  const client = useStationClient();

  const [me, setMe] = useState<ListenerMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [resending, setResending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback((message: string) => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    setNotice(message);
    noticeTimerRef.current = setTimeout(() => setNotice(null), 3000);
  }, []);

  useEffect(() => {
    if (!client || !listenerAuth) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    client
      .me()
      .then((data) => {
        if (!cancelled) setMe(data);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof StationClientError && err.status === 401) setListenerAuth(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, listenerAuth, setListenerAuth]);

  const resendVerification = useCallback(async () => {
    if (!client) return;
    setResending(true);
    try {
      await client.resendVerification();
      notify('Verification email sent, if this station has email configured.');
    } catch {
      notify('Could not reach the station.');
    } finally {
      setResending(false);
    }
  }, [client, notify]);

  if (!station) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.centerFill} edges={['bottom', 'left', 'right']}>
          <ThemedText themeColor="textSecondary" style={styles.centerText}>
            Select a station on Discover first — account details are per-station.
          </ThemedText>
        </SafeAreaView>
      </ThemedView>
    );
  }

  if (!listenerAuth) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.centerFill} edges={['bottom', 'left', 'right']}>
          <ThemedText themeColor="textSecondary" style={styles.centerText}>
            Not logged in to {station.name}.
          </ThemedText>
          <Pressable
            onPress={() => router.push('/listener-login')}
            style={[styles.primaryButton, { backgroundColor: colors.accent }]}>
            <ThemedText type="smallBold" style={{ color: colors.background }}>
              Log in
            </ThemedText>
          </Pressable>
        </SafeAreaView>
      </ThemedView>
    );
  }

  const providerLabel =
    me?.provider === 'tip'
      ? 'Supporter access from a tip'
      : me?.provider === 'stripe'
        ? 'Stripe subscription'
        : me?.provider
          ? `Subscription via ${me.provider}`
          : null;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.content} edges={['bottom', 'left', 'right']}>
        <ThemedText type="small" themeColor="textSecondary">
          {station.name}
        </ThemedText>

        {loading ? (
          <View style={styles.centerFill}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : (
          <>
            <View style={[styles.card, { backgroundColor: colors.backgroundElement }]}>
              <ThemedText type="smallBold" numberOfLines={1}>
                {me?.email || me?.displayName || 'Listener'}
              </ThemedText>
              <ThemedText type="small" themeColor="accent" style={styles.tierLabel}>
                {(me?.tier ?? listenerAuth.tier).replace('_', ' ')}
              </ThemedText>
            </View>

            {me?.hasAccount ? (
              <View style={[styles.row, { backgroundColor: colors.backgroundElement }]}>
                <View style={styles.rowInfo}>
                  <View style={styles.verifyRow}>
                    <Ionicons
                      name={me.emailVerified ? 'shield-checkmark' : 'shield-outline'}
                      size={16}
                      color={me.emailVerified ? colors.accent : colors.textSecondary}
                    />
                    <ThemedText type="small">
                      {me.emailVerified ? 'Email verified' : 'Email not verified yet'}
                    </ThemedText>
                  </View>
                </View>
                {!me.emailVerified ? (
                  <Pressable
                    onPress={resendVerification}
                    disabled={resending}
                    style={[styles.ghostButton, { borderColor: colors.border, opacity: resending ? 0.6 : 1 }]}>
                    <ThemedText type="small">{resending ? '…' : 'Resend'}</ThemedText>
                  </Pressable>
                ) : null}
              </View>
            ) : (
              <ThemedText type="small" themeColor="textSecondary">
                This is a display-name-only profile — no full account yet.
              </ThemedText>
            )}

            {providerLabel || me?.currentPeriodEnd ? (
              <View style={[styles.card, { backgroundColor: colors.backgroundElement }]}>
                {providerLabel ? <ThemedText type="small">{providerLabel}</ThemedText> : null}
                {me?.subscriptionStatus ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    Status: {me.subscriptionStatus}
                  </ThemedText>
                ) : null}
                {me?.currentPeriodEnd ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    Renews or ends: {new Date(me.currentPeriodEnd).toLocaleDateString()}
                  </ThemedText>
                ) : null}
              </View>
            ) : null}

            {notice ? (
              <ThemedText type="small" themeColor="accent">
                {notice}
              </ThemedText>
            ) : null}

            <Pressable onPress={() => setListenerAuth(null)} style={[styles.ghostButton, { borderColor: colors.border }]}>
              <ThemedText type="smallBold">Log out</ThemedText>
            </Pressable>
          </>
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  centerFill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
  },
  centerText: {
    textAlign: 'center',
  },
  card: {
    borderRadius: Radius.xl,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  tierLabel: {
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: Radius.xl,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  rowInfo: {
    flex: 1,
    gap: 2,
  },
  verifyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  primaryButton: {
    borderRadius: Radius.lg,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.four,
    alignItems: 'center',
  },
  ghostButton: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    alignItems: 'center',
  },
});
