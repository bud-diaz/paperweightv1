import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useStationClient, useStationStore } from '@/state/stationStore';

type Mode = 'login' | 'redeem';

export function ListenerLoginScreen() {
  const colors = useTheme();
  const router = useRouter();
  const { station, listenerAuth, setListenerAuth } = useStationStore();
  const client = useStationClient();

  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!client || !station) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.centerFill}>
          <ThemedText themeColor="textSecondary" style={styles.centerText}>
            Select a station on Discover first — listener login is per-station.
          </ThemedText>
        </SafeAreaView>
      </ThemedView>
    );
  }

  async function submitLogin() {
    setSubmitting(true);
    setError(null);
    try {
      const { res, data } = await client!.login(email.trim(), password);
      if (!res.ok || !data.token) {
        setError(data.error || 'Invalid email or password');
        return;
      }
      setListenerAuth({ token: data.token, tier: data.tier || 'free' });
      router.back();
    } catch {
      setError('Could not reach the station. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function submitRedeem() {
    const trimmed = token.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setError(null);
    try {
      const { res, data } = await client!.redeemToken(trimmed);
      if (!res.ok) {
        setError(data.error || 'Invalid or expired token');
        return;
      }
      setListenerAuth({ token: trimmed, tier: data.tier || 'free' });
      router.back();
    } catch {
      setError('Could not reach the station. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.content} edges={['bottom', 'left', 'right']}>
        <ThemedText type="small" themeColor="textSecondary">
          {station.name}
        </ThemedText>

        {listenerAuth ? (
          <View style={[styles.signedIn, { backgroundColor: colors.backgroundElement, borderColor: colors.border }]}>
            <ThemedText type="smallBold">Signed in ({listenerAuth.tier})</ThemedText>
            <Pressable onPress={() => setListenerAuth(null)}>
              <ThemedText themeColor="accent">Sign out</ThemedText>
            </Pressable>
          </View>
        ) : null}

        <View style={[styles.tabRow, { borderColor: colors.border }]}>
          <Pressable
            onPress={() => {
              setMode('login');
              setError(null);
            }}
            style={[styles.tab, mode === 'login' && { backgroundColor: colors.accentSoft }]}>
            <ThemedText type="smallBold" themeColor={mode === 'login' ? 'accent' : 'textSecondary'}>
              Log in
            </ThemedText>
          </Pressable>
          <Pressable
            onPress={() => {
              setMode('redeem');
              setError(null);
            }}
            style={[styles.tab, mode === 'redeem' && { backgroundColor: colors.accentSoft }]}>
            <ThemedText type="smallBold" themeColor={mode === 'redeem' ? 'accent' : 'textSecondary'}>
              Redeem token
            </ThemedText>
          </Pressable>
        </View>

        {mode === 'login' ? (
          <View style={styles.form}>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="Email"
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              style={[styles.input, { backgroundColor: colors.backgroundElement, color: colors.text }]}
            />
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="Password"
              placeholderTextColor={colors.textSecondary}
              secureTextEntry
              style={[styles.input, { backgroundColor: colors.backgroundElement, color: colors.text }]}
            />
            {error ? (
              <ThemedText type="small" style={{ color: colors.accent }}>
                {error}
              </ThemedText>
            ) : null}
            <Pressable
              onPress={submitLogin}
              disabled={submitting || !email.trim() || !password}
              style={[styles.submitButton, { backgroundColor: colors.accent, opacity: submitting ? 0.7 : 1 }]}>
              {submitting ? <ActivityIndicator color="#fff" /> : <ThemedText style={styles.submitLabel}>Log in</ThemedText>}
            </Pressable>
          </View>
        ) : (
          <View style={styles.form}>
            <TextInput
              value={token}
              onChangeText={setToken}
              placeholder="Paste your token"
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.input, { backgroundColor: colors.backgroundElement, color: colors.text }]}
            />
            {error ? (
              <ThemedText type="small" style={{ color: colors.accent }}>
                {error}
              </ThemedText>
            ) : null}
            <Pressable
              onPress={submitRedeem}
              disabled={submitting || !token.trim()}
              style={[styles.submitButton, { backgroundColor: colors.accent, opacity: submitting ? 0.7 : 1 }]}>
              {submitting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <ThemedText style={styles.submitLabel}>Redeem</ThemedText>
              )}
            </Pressable>
          </View>
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
    paddingHorizontal: Spacing.four,
  },
  centerText: {
    textAlign: 'center',
  },
  signedIn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 14,
    borderWidth: 1,
    padding: Spacing.three,
  },
  tabRow: {
    flexDirection: 'row',
    borderRadius: 999,
    borderWidth: 1,
    padding: 3,
    gap: 3,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.one,
    borderRadius: 999,
  },
  form: {
    gap: Spacing.two,
  },
  input: {
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 16,
  },
  submitButton: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    paddingVertical: Spacing.two,
    marginTop: Spacing.one,
  },
  submitLabel: {
    color: '#ffffff',
    fontWeight: '700',
  },
});
