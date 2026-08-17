import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import * as Linking from 'expo-linking';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';

import { redeemDevicePairing } from '@/api/dashboardClient';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useStudioStore } from '@/state/studioStore';

/**
 * Unpaired-state gate: camera-permission request + QR scan. Pairing itself
 * always originates on an already-authenticated desktop Studio session
 * (Security panel → "Pair a device" → QR) — this screen can only consume a
 * code shown there, never initiate one. Copy below says so explicitly per
 * the Phase 5 plan's gotcha: a core-seeming tab that's unusable without an
 * external desktop-first step is a plausible store-review rejection reason
 * if framed as a dead end instead of an optional creator-only surface.
 */
export function StudioGate() {
  const colors = useTheme();
  const { setStudio } = useStudioStore();
  const [permission, requestPermission] = useCameraPermissions();
  const [redeeming, setRedeeming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scanLockRef = useRef(false);

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      requestPermission();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permission?.granted]);

  const processScannedUrl = useCallback(
    async (raw: string) => {
      if (scanLockRef.current) return;
      scanLockRef.current = true;
      setError(null);

      let origin: string;
      let pairToken: string;
      try {
        const parsed = new URL(raw);
        const pt = parsed.searchParams.get('pt');
        if (!pt) throw new Error('missing pt');
        origin = parsed.origin;
        pairToken = pt;
      } catch {
        setError("That doesn't look like a Paperweight pairing code — try again.");
        scanLockRef.current = false;
        return;
      }

      setRedeeming(true);
      try {
        const data = await redeemDevicePairing(origin, pairToken);
        if (!data.ok || !data.token) {
          setError(data.error || 'Pairing failed — the code may have expired. Generate a new one on desktop.');
          scanLockRef.current = false;
          return;
        }
        setStudio({
          baseUrl: origin,
          deviceToken: data.token,
          deviceLabel: Platform.OS === 'ios' ? 'iPhone' : 'Android phone',
          pairedAt: new Date().toISOString(),
        });
      } catch {
        setError('Could not reach the station — check the connection and try again.');
        scanLockRef.current = false;
      } finally {
        setRedeeming(false);
      }
    },
    [setStudio]
  );

  const handleScan = useCallback((result: BarcodeScanningResult) => processScannedUrl(result.data), [processScannedUrl]);

  if (!permission) {
    return (
      <ThemedView style={styles.container}>
        <View style={styles.centerFill}>
          <ActivityIndicator color={colors.accent} />
        </View>
      </ThemedView>
    );
  }

  if (!permission.granted) {
    return (
      <ThemedView style={styles.container}>
        <View style={styles.centerFill}>
          <ThemedText type="subtitle" style={styles.centerText}>
            Camera access needed
          </ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.centerText}>
            Paperweight uses your camera only to scan the pairing QR code shown in Studio on your
            desktop — nothing is recorded or uploaded.
          </ThemedText>
          <Pressable
            onPress={() => (permission.canAskAgain ? requestPermission() : Linking.openSettings())}
            style={[styles.primaryButton, { backgroundColor: colors.accent }]}>
            <ThemedText type="smallBold" style={{ color: colors.background }}>
              {permission.canAskAgain ? 'Allow camera access' : 'Open Settings'}
            </ThemedText>
          </Pressable>
        </View>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <ThemedText type="title" style={styles.title}>
          Studio
        </ThemedText>
        <ThemedText themeColor="textSecondary">
          Open Studio on your desktop, go to Security, and scan the QR code shown there to pair
          this phone. Studio is a creator-only, desktop-first surface — pairing isn't required for
          Discover, Play, or Stack.
        </ThemedText>
      </View>
      <View style={styles.cameraWrap}>
        <CameraView
          style={StyleSheet.absoluteFill}
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={handleScan}
        />
        <View style={[styles.scanFrame, { borderColor: colors.accent }]} />
        {redeeming ? (
          <View style={styles.scanOverlay}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : null}
      </View>
      {error ? (
        <ThemedText type="small" themeColor="accent" style={styles.errorText}>
          {error}
        </ThemedText>
      ) : null}
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
    gap: Spacing.two,
  },
  title: {
    fontSize: 32,
    lineHeight: 38,
  },
  cameraWrap: {
    flex: 1,
    margin: Spacing.three,
    borderRadius: Radius.lg,
    overflow: 'hidden',
  },
  scanFrame: {
    position: 'absolute',
    top: '25%',
    left: '15%',
    right: '15%',
    bottom: '35%',
    borderWidth: 2,
    borderRadius: Radius.md,
  },
  scanOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  errorText: {
    textAlign: 'center',
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.three,
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
  primaryButton: {
    borderRadius: Radius.md,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.four,
    marginTop: Spacing.two,
  },
});
