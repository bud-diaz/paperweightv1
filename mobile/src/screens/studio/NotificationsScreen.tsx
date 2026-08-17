import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, TextInput, View } from 'react-native';

import { DashboardClientError } from '@/api/dashboardClient';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useDashboardClient, useStudioStore } from '@/state/studioStore';

/**
 * "Notifications" here means the notify-webhook settings — confirmed by
 * reading the actual product, not assumed: there is no persisted log of
 * past notify sends anywhere in the backend (src/notify/ is fire-and-forget
 * only, no notify_log table), and web Studio's own equivalent
 * (SettingsView.tsx, "button-save-notifications") is this same settings
 * form, not an event history. Native push is a different, unrelated
 * concept this app has no backend support for.
 */
export function NotificationsScreen() {
  const colors = useTheme();
  const { signOut } = useStudioStore();
  const dashboard = useDashboardClient();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [liveEnabled, setLiveEnabled] = useState(true);
  const [emailConfigured, setEmailConfigured] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback((message: string) => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    setNotice(message);
    noticeTimerRef.current = setTimeout(() => setNotice(null), 2500);
  }, []);

  useEffect(() => {
    if (!dashboard) return;
    let cancelled = false;
    dashboard
      .getSettings()
      .then((data) => {
        if (cancelled) return;
        setWebhookUrl(data.notifyWebhookUrl);
        setLiveEnabled(data.notifyLiveEnabled);
        setEmailConfigured(data.emailConfigured);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof DashboardClientError && err.status === 401) signOut();
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dashboard, signOut]);

  const save = useCallback(async () => {
    if (!dashboard) return;
    setSaving(true);
    try {
      await dashboard.updateSettings({ notifyWebhookUrl: webhookUrl, notifyLiveEnabled: liveEnabled });
      notify('Saved.');
    } catch (err) {
      if (err instanceof DashboardClientError) {
        if (err.status === 401) {
          signOut();
          return;
        }
        const data = err.data as { error?: string };
        notify(data?.error || 'Failed to save.');
      } else {
        notify('Failed to save — connection error.');
      }
    } finally {
      setSaving(false);
    }
  }, [dashboard, webhookUrl, liveEnabled, notify, signOut]);

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <ThemedText type="subtitle">Notifications</ThemedText>
        {notice ? (
          <ThemedText type="small" themeColor="accent">
            {notice}
          </ThemedText>
        ) : null}
      </View>
      {loading ? (
        <View style={styles.centerFill}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <View style={styles.body}>
          <View style={[styles.card, { backgroundColor: colors.backgroundElement }]}>
            <View style={styles.toggleRow}>
              <View style={styles.toggleInfo}>
                <ThemedText type="small">Notify on go-live</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Ping your webhook when you start broadcasting.
                </ThemedText>
              </View>
              <Switch
                value={liveEnabled}
                onValueChange={setLiveEnabled}
                trackColor={{ false: colors.border, true: colors.accent }}
                thumbColor={colors.background}
              />
            </View>
            <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>
              Discord-compatible webhook URL
            </ThemedText>
            <TextInput
              value={webhookUrl}
              onChangeText={setWebhookUrl}
              placeholder="https://discord.com/api/webhooks/…"
              placeholderTextColor={colors.textSecondary}
              style={[styles.input, { color: colors.text, borderColor: colors.border }]}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
              {emailConfigured
                ? 'Email is also configured — supporters get emailed on new posts.'
                : 'Email is not configured — only this webhook fires on new posts/go-live.'}
            </ThemedText>
            <Pressable
              onPress={save}
              disabled={saving}
              style={[styles.saveButton, { backgroundColor: colors.accent, opacity: saving ? 0.6 : 1 }]}>
              <ThemedText type="smallBold" style={{ color: colors.background }}>
                {saving ? 'Saving…' : 'Save notifications'}
              </ThemedText>
            </Pressable>
          </View>
        </View>
      )}
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
  body: {
    padding: Spacing.three,
  },
  card: {
    borderRadius: 14,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  toggleInfo: {
    flex: 1,
    gap: 2,
  },
  fieldLabel: {
    marginTop: Spacing.one,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
    fontSize: 14,
  },
  hint: {
    marginTop: -Spacing.one,
  },
  saveButton: {
    borderRadius: 10,
    paddingVertical: Spacing.two,
    alignItems: 'center',
    marginTop: Spacing.one,
  },
  centerFill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
