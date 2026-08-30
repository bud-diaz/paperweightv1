import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { StationClientError } from '@/api/stationClient';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useStationClient, useStationStore } from '@/state/stationStore';

type AccountInfo = Awaited<ReturnType<NonNullable<ReturnType<typeof useStationClient>>['me']>>;
type LoadState = 'idle' | 'loading' | 'ready' | 'error';

function valueOrDash(value?: string | null) {
  return value && value.trim() ? value : '—';
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <ThemedText type="small" themeColor="textSecondary">{label}</ThemedText>
      <ThemedText type="smallBold" numberOfLines={2}>{value}</ThemedText>
    </View>
  );
}

export function AccountSettingsModal() {
  const colors = useTheme();
  const client = useStationClient();
  const { station, baseUrl, listenerAuth, setListenerAuth } = useStationStore();
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    if (!client || !listenerAuth) return;
    const requestId = ++requestIdRef.current;
    setLoadState('loading');
    setError(null);
    try {
      const info = await client.me();
      if (requestId !== requestIdRef.current) return;
      setAccount(info);
      setLoadState('ready');
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      if (err instanceof StationClientError && err.status === 401) {
        setListenerAuth(null);
        setError('Your listener session expired. Log in again from Discover.');
      } else {
        setError('Could not reach the station account endpoint.');
      }
      setLoadState('error');
    }
  }, [client, listenerAuth, setListenerAuth]);

  useEffect(() => {
    load();
  }, [load]);

  if (!station && !baseUrl) {
    return (
      <ThemedView style={styles.centerFill}>
        <ThemedText themeColor="textSecondary" style={styles.centerText}>Select a station before opening account settings.</ThemedText>
      </ThemedView>
    );
  }

  if (!listenerAuth) {
    return (
      <ThemedView style={styles.centerFill}>
        <ThemedText type="smallBold" style={styles.centerText}>Not logged in as a listener.</ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.centerText}>Use Discover → Log in to view email verification, tier, and tipping identity for this station.</ThemedText>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={[styles.card, { backgroundColor: colors.backgroundElement, borderColor: colors.border }]}>
          <ThemedText type="small" themeColor="textSecondary">Station</ThemedText>
          <ThemedText type="smallBold" numberOfLines={1}>{station?.name || baseUrl}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>{baseUrl}</ThemedText>
        </View>

        {loadState === 'loading' ? (
          <View style={styles.loadingRow}><ActivityIndicator color={colors.accent} /></View>
        ) : error ? (
          <View style={[styles.card, { backgroundColor: colors.backgroundElement, borderColor: colors.border }]}>
            <ThemedText type="small" style={{ color: colors.accent }}>{error}</ThemedText>
            <Pressable onPress={load} style={styles.linkButton}><ThemedText themeColor="accent">Try again</ThemedText></Pressable>
          </View>
        ) : account ? (
          <View style={[styles.card, { backgroundColor: colors.backgroundElement, borderColor: colors.border }]}>
            <ThemedText type="smallBold">Listener account</ThemedText>
            <Row label="Email" value={valueOrDash(account.email)} />
            <Row label="Email verified" value={account.hasAccount ? (account.emailVerified ? 'Verified' : 'Not verified') : 'Profile-only listener'} />
            <Row label="Supporter tier" value={account.tier || listenerAuth.tier || 'free'} />
            <Row label="Subscription" value={account.subscriptionStatus ? `${account.subscriptionStatus}${account.provider ? ` via ${account.provider}` : ''}` : 'No active subscription'} />
            <Row label="Tipping identity" value={valueOrDash(account.displayName || account.email)} />
            <Row label="Marketing updates" value={account.marketingOptIn ? 'Opted in' : 'Not opted in'} />
            <Row label="Password" value={account.hasPassword ? 'Set' : 'Needs setup'} />
            {account.currentPeriodEnd ? <Row label="Current period ends" value={account.currentPeriodEnd} /> : null}
          </View>
        ) : null}

        <Pressable onPress={() => setListenerAuth(null)} style={[styles.signOutButton, { borderColor: colors.border }]}>
          <ThemedText type="smallBold" themeColor="textSecondary">Sign out listener session</ThemedText>
        </Pressable>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.two, padding: Spacing.four },
  centerText: { textAlign: 'center' },
  scroll: { padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.six },
  card: { borderRadius: 18, borderWidth: 1, padding: Spacing.three, gap: Spacing.two },
  loadingRow: { padding: Spacing.four, alignItems: 'center' },
  infoRow: { gap: 2, paddingVertical: Spacing.one },
  linkButton: { alignSelf: 'flex-start', paddingVertical: Spacing.one },
  signOutButton: { borderWidth: 1, borderRadius: 999, alignItems: 'center', paddingVertical: Spacing.two },
});
