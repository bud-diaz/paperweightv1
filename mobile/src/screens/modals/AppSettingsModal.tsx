import * as Linking from 'expo-linking';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useStationStore } from '@/state/stationStore';

/**
 * App-level prefs: the manual station URL/LAN-IP override built into
 * `stationStore` since Phase 2 (had no UI until now) and a Wi-Fi settings
 * shortcut. No theme toggle here — the app has been dark-only since the
 * Phase 3 addendum (`hooks/use-theme.ts`), and the design spec never
 * defined a light mode to toggle to; a toggle with nothing real to switch
 * would be a decorative no-op, the same category of control this project
 * has consistently avoided (e.g. the inert vs. real transport buttons in
 * the Play tab).
 */
export function AppSettingsModal() {
  const colors = useTheme();
  const { station, manualBaseUrl, baseUrl, setManualBaseUrl } = useStationStore();

  const [draft, setDraft] = useState(manualBaseUrl ?? '');
  const [notice, setNotice] = useState<string | null>(null);

  const save = () => {
    const trimmed = draft.trim();
    setManualBaseUrl(trimmed || null);
    setNotice(trimmed ? 'Using manual override.' : 'Cleared — using the discovered station URL.');
  };

  const clear = () => {
    setDraft('');
    setManualBaseUrl(null);
    setNotice('Cleared — using the discovered station URL.');
  };

  const openWifiSettings = () => {
    if (Platform.OS === 'android') {
      Linking.sendIntent('android.settings.WIFI_SETTINGS');
    } else {
      Linking.openSettings();
    }
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.content} edges={['bottom', 'left', 'right']}>
        <View style={styles.section}>
          <ThemedText type="smallBold">Network override</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Point this app at a station directly by URL or LAN IP — useful for a station not yet
            listed on System.Pape, or reaching a dev server on the same Wi-Fi. Leave blank to use
            the station picked on Discover.
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Currently using: {baseUrl ?? 'no station selected'}
            {manualBaseUrl ? ' (manual override)' : station ? ' (from Discover)' : ''}
          </ThemedText>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="http://10.0.0.11:3001"
            placeholderTextColor={colors.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            style={[styles.input, { backgroundColor: colors.backgroundElement, color: colors.text }]}
          />
          {notice ? (
            <ThemedText type="small" themeColor="accent">
              {notice}
            </ThemedText>
          ) : null}
          <View style={styles.buttonRow}>
            <Pressable onPress={save} style={[styles.primaryButton, { backgroundColor: colors.accent }]}>
              <ThemedText type="smallBold" style={{ color: colors.background }}>
                Save override
              </ThemedText>
            </Pressable>
            {manualBaseUrl ? (
              <Pressable onPress={clear} style={[styles.ghostButton, { borderColor: colors.border }]}>
                <ThemedText type="smallBold">Clear</ThemedText>
              </Pressable>
            ) : null}
          </View>
        </View>

        <View style={[styles.section, styles.sectionDivider, { borderColor: colors.border }]}>
          <ThemedText type="smallBold">Wi-Fi</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {Platform.OS === 'android'
              ? 'Jump straight to Android’s Wi-Fi settings.'
              : 'iOS doesn’t allow apps to link directly into the Wi-Fi settings pane — this opens the Settings app instead, where Wi-Fi is one tap away.'}
          </ThemedText>
          <Pressable onPress={openWifiSettings} style={[styles.ghostButton, { borderColor: colors.border, alignSelf: 'flex-start' }]}>
            <ThemedText type="smallBold">{Platform.OS === 'android' ? 'Open Wi-Fi settings' : 'Open Settings'}</ThemedText>
          </Pressable>
        </View>
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
    gap: Spacing.four,
  },
  section: {
    gap: Spacing.two,
  },
  sectionDivider: {
    borderTopWidth: 1,
    paddingTop: Spacing.four,
  },
  input: {
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 16,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: Spacing.two,
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
    paddingHorizontal: Spacing.four,
    alignItems: 'center',
  },
});
