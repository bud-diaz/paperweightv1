import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { redeemPairToken } from '@/api/dashboardClient';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useDashboardAuth } from '@/state/dashboardAuthStore';

/**
 * Parses a scanned pairUrl (`{station publicUrl}/pair?pt={pairToken}`, per
 * src/api/dashboard.js's POST /devices/pair response) into the origin to
 * redeem against and the pairing token. Tries the global URL constructor
 * first; falls back to manual extraction if that can't parse the string
 * (RN/Hermes's built-in URL support has historically been inconsistent).
 */
function parsePairUrl(raw: string): { baseUrl: string; pairToken: string } | null {
  try {
    const url = new URL(raw);
    const pairToken = url.searchParams.get('pt');
    return pairToken ? { baseUrl: url.origin, pairToken } : null;
  } catch {
    const originMatch = raw.match(/^(https?:\/\/[^/?#]+)/);
    const ptMatch = raw.match(/[?&]pt=([^&#]+)/);
    if (!originMatch || !ptMatch) return null;
    return { baseUrl: originMatch[1], pairToken: decodeURIComponent(ptMatch[1]) };
  }
}

type Status = 'scanning' | 'redeeming' | 'error';

export function StudioPairScreen() {
  const colors = useTheme();
  const router = useRouter();
  const { pair } = useDashboardAuth();

  const [permission, requestPermission] = useCameraPermissions();
  const [status, setStatus] = useState<Status>('scanning');
  const [error, setError] = useState<string | null>(null);
  const scannedRef = useRef(false);

  async function handleScan(data: string) {
    if (scannedRef.current) return;
    const parsed = parsePairUrl(data);
    if (!parsed) return; // Not a recognizable pairing QR — keep scanning.

    scannedRef.current = true;
    setStatus('redeeming');
    setError(null);
    try {
      const result = await redeemPairToken(parsed.baseUrl, parsed.pairToken);
      if (!result.token) throw new Error('Station did not return a device token');
      await pair(parsed.baseUrl, result.token, 'Mobile');
      router.back();
    } catch (err) {
      scannedRef.current = false;
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Pairing failed — try scanning again.');
    }
  }

  if (!permission) {
    return (
      <ThemedView style={styles.container}>
        <ActivityIndicator color={colors.accent} />
      </ThemedView>
    );
  }

  if (!permission.granted) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.permissionContent} edges={['bottom', 'left', 'right']}>
          <ThemedText type="default" themeColor="textSecondary" style={styles.centerText}>
            Camera access is needed to scan the pairing QR code shown on your station's desktop
            dashboard.
          </ThemedText>
          {permission.canAskAgain ? (
            <Pressable onPress={requestPermission} style={[styles.button, { backgroundColor: colors.accent }]}>
              <ThemedText style={styles.buttonLabel}>Grant camera access</ThemedText>
            </Pressable>
          ) : (
            <Pressable
              onPress={() => Linking.openSettings()}
              style={[styles.button, { backgroundColor: colors.accent }]}>
              <ThemedText style={styles.buttonLabel}>Open Settings</ThemedText>
            </Pressable>
          )}
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <CameraView
        style={styles.camera}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={({ data }) => handleScan(data)}
      />
      <SafeAreaView style={styles.overlay} edges={['bottom', 'left', 'right']}>
        {status === 'redeeming' ? (
          <View style={[styles.statusPill, { backgroundColor: colors.backgroundElement }]}>
            <ActivityIndicator color={colors.accent} />
            <ThemedText type="smallBold">Pairing…</ThemedText>
          </View>
        ) : status === 'error' ? (
          <View style={[styles.statusPill, { backgroundColor: colors.backgroundElement }]}>
            <ThemedText type="small" style={{ color: colors.accent }}>
              {error}
            </ThemedText>
          </View>
        ) : (
          <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
            Point your camera at the QR code shown on your station's desktop dashboard.
          </ThemedText>
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  camera: {
    flex: 1,
  },
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    paddingBottom: Spacing.four,
    paddingHorizontal: Spacing.four,
  },
  hint: {
    textAlign: 'center',
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: 999,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  permissionContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
  },
  centerText: {
    textAlign: 'center',
  },
  button: {
    borderRadius: 999,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
  buttonLabel: {
    color: '#ffffff',
    fontWeight: '700',
  },
});
