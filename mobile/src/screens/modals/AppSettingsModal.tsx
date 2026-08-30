import { useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { createStationClient } from '@/api/stationClient';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAppSettings, type ThemeMode } from '@/state/appSettingsStore';
import { useStationStore } from '@/state/stationStore';

const MODES: ThemeMode[] = ['system', 'light', 'dark'];

function normalizeBaseUrl(input: string) {
  const trimmed = input.trim().replace(/\/+$/, '');
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  const parsed = new URL(withScheme);
  return parsed.origin;
}

export function AppSettingsModal() {
  const colors = useTheme();
  const { themeMode, setThemeMode } = useAppSettings();
  const { station, manualBaseUrl, baseUrl, setManualBaseUrl } = useStationStore();
  const [manualUrlInput, setManualUrlInput] = useState(manualBaseUrl || '');
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function openWifiSettings() {
    if (Platform.OS === 'android') {
      try {
        await Linking.sendIntent('android.settings.WIFI_SETTINGS');
        return;
      } catch {
        // Fall through to the app/system settings root.
      }
    }
    await Linking.openSettings();
  }

  async function saveManualUrl() {
    setChecking(true);
    setError(null);
    setMessage(null);
    try {
      const normalized = normalizeBaseUrl(manualUrlInput);
      if (!normalized) {
        setManualBaseUrl(null);
        setMessage('Manual override cleared. Discover station URL is active again.');
        return;
      }
      const health = await createStationClient(normalized).health();
      setManualBaseUrl(normalized);
      setManualUrlInput(normalized);
      setMessage(`Connected to ${health.station || normalized}. Manual override saved.`);
    } catch {
      setError('Could not reach that station URL. Use the LAN IP and port from the same WiFi network, for example http://192.168.1.23:3000.');
    } finally {
      setChecking(false);
    }
  }

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={[styles.card, { backgroundColor: colors.backgroundElement, borderColor: colors.border }]}>
          <ThemedText type="smallBold">Theme</ThemedText>
          <View style={styles.rowWrap}>
            {MODES.map((mode) => (
              <Pressable key={mode} onPress={() => setThemeMode(mode)} style={[styles.chip, themeMode === mode && { backgroundColor: colors.accentSoft }]}>
                <ThemedText type="smallBold" themeColor={themeMode === mode ? 'accent' : 'textSecondary'}>{mode}</ThemedText>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: colors.backgroundElement, borderColor: colors.border }]}>
          <ThemedText type="smallBold">Network</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            iPhone can only open the main Settings app. Android opens WiFi settings directly when the OS allows it.
          </ThemedText>
          <Pressable onPress={openWifiSettings} style={[styles.secondaryButton, { backgroundColor: colors.backgroundSelected }]}>
            <ThemedText type="smallBold">Open WiFi settings</ThemedText>
          </Pressable>
        </View>

        <View style={[styles.card, { backgroundColor: colors.backgroundElement, borderColor: colors.border }]}>
          <ThemedText type="smallBold">Manual station URL / LAN IP</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Use this when your station is running locally and is not listed in Discover yet. This URL overrides the selected Discover station until cleared.
          </ThemedText>
          <TextInput
            value={manualUrlInput}
            onChangeText={setManualUrlInput}
            placeholder="http://192.168.1.23:3000"
            placeholderTextColor={colors.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            style={[styles.input, { backgroundColor: colors.backgroundSelected, color: colors.text }]}
          />
          <ThemedText type="small" themeColor="textSecondary">
            Current: {baseUrl || 'No station selected'}{station ? ` · Discover: ${station.name}` : ''}
          </ThemedText>
          {message ? <ThemedText type="small" style={{ color: colors.live }}>{message}</ThemedText> : null}
          {error ? <ThemedText type="small" style={{ color: colors.accent }}>{error}</ThemedText> : null}
          <View style={styles.actions}>
            <Pressable onPress={saveManualUrl} disabled={checking} style={[styles.primaryButton, { backgroundColor: colors.accent, opacity: checking ? 0.7 : 1 }]}>
              {checking ? <ActivityIndicator color="#fff" /> : <ThemedText style={styles.primaryLabel}>Check & save</ThemedText>}
            </Pressable>
            <Pressable
              onPress={() => {
                setManualUrlInput('');
                setManualBaseUrl(null);
                setMessage('Manual override cleared.');
                setError(null);
              }}
              disabled={checking}
              style={[styles.clearButton, { borderColor: colors.border }]}>
              <ThemedText type="smallBold" themeColor="textSecondary">Clear</ThemedText>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.six },
  card: { borderRadius: 18, borderWidth: 1, padding: Spacing.three, gap: Spacing.two },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: { borderRadius: 999, paddingHorizontal: Spacing.three, paddingVertical: Spacing.one },
  secondaryButton: { alignItems: 'center', borderRadius: 999, paddingVertical: Spacing.two },
  input: { borderRadius: 12, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, fontSize: 16 },
  actions: { flexDirection: 'row', gap: Spacing.two },
  primaryButton: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 999, paddingVertical: Spacing.two },
  primaryLabel: { color: '#ffffff', fontWeight: '800' },
  clearButton: { borderRadius: 999, borderWidth: 1, paddingHorizontal: Spacing.three, alignItems: 'center', justifyContent: 'center' },
});
