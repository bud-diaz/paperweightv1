import * as SplashScreen from 'expo-splash-screen';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useColorScheme, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { PlayerEngineProvider } from '@/player/PlayerEngineContext';
import { StashProvider } from '@/stash/StashContext';
import { Toast } from '@/components/Toast';
import { AppSettingsProvider, useAppSettings } from '@/state/appSettingsStore';
import { DashboardAuthProvider } from '@/state/dashboardAuthStore';
import { StationStoreProvider } from '@/state/stationStore';

let nativeSplashHideRequested = false;

function hideNativeSplash(reason: string) {
  if (nativeSplashHideRequested) return;
  nativeSplashHideRequested = true;
  SplashScreen.hideAsync()
    .then(() => {
      if (__DEV__) console.log(`[PaperweightMobile] native splash hidden after ${reason}`);
    })
    .catch((error) => {
      nativeSplashHideRequested = false;
      if (__DEV__) console.warn('Failed to hide splash screen', error);
    });
}

// Let expo-splash-screen's native CONTENT_APPEARED listener auto-release the
// launch screen on cold Android starts. A manual preventAutoHideAsync() call can
// leave Galaxy A12/API 30 dev-client launches stuck behind the native pre-draw
// splash gate even after JS has mounted; the guarded hide calls below are only
// fallback/idempotent cleanup.
setTimeout(() => hideNativeSplash('startup fallback'), 1500);

type AppShellProps = {
  onReadyLayout: () => void;
};

function AppShell({ onReadyLayout }: AppShellProps) {
  const systemScheme = useColorScheme();
  const { themeMode } = useAppSettings();
  const effectiveScheme = themeMode === 'system' ? systemScheme : themeMode;

  return (
    <View style={{ flex: 1 }} onLayout={onReadyLayout}>
      <ThemeProvider value={effectiveScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <StationStoreProvider>
          <PlayerEngineProvider>
            <StashProvider>
              <DashboardAuthProvider>
                <Stack screenOptions={{ headerShown: false }}>
                  <Stack.Screen name="(tabs)" />
                  <Stack.Screen
                    name="listener-login"
                    options={{ presentation: 'modal', headerShown: true, title: 'Listener Login' }}
                  />
                  <Stack.Screen
                    name="app-settings"
                    options={{ presentation: 'modal', headerShown: true, title: 'App Settings' }}
                  />
                  <Stack.Screen
                    name="account-settings"
                    options={{ presentation: 'modal', headerShown: true, title: 'Account Settings' }}
                  />
                  <Stack.Screen name="project/[id]" options={{ headerShown: true, title: 'Collection' }} />
                  <Stack.Screen
                    name="studio-pair"
                    options={{ presentation: 'modal', headerShown: true, title: 'Pair Studio' }}
                  />
                  <Stack.Screen name="studio/now-playing" options={{ headerShown: true, title: 'Now Playing' }} />
                  <Stack.Screen name="studio/quick-stats" options={{ headerShown: true, title: 'Quick Stats' }} />
                  <Stack.Screen name="studio/upload" options={{ headerShown: true, title: 'Upload Media' }} />
                  <Stack.Screen
                    name="studio/release-scheduling"
                    options={{ headerShown: true, title: 'Release Scheduling' }}
                  />
                  <Stack.Screen name="studio/notifications" options={{ headerShown: true, title: 'Notifications' }} />
                  <Stack.Screen name="studio/device" options={{ headerShown: true, title: 'Device' }} />
                </Stack>
                <Toast />
              </DashboardAuthProvider>
            </StashProvider>
          </PlayerEngineProvider>
        </StationStoreProvider>
      </ThemeProvider>
    </View>
  );
}

export default function RootLayout() {
  const [appReady, setAppReady] = useState(false);
  const [contentLaidOut, setContentLaidOut] = useState(false);
  const [fallbackElapsed, setFallbackElapsed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const readyTimer = setTimeout(() => {
      if (!cancelled) setAppReady(true);
    }, 0);
    const fallbackTimer = setTimeout(() => {
      if (!cancelled) setFallbackElapsed(true);
    }, 750);
    return () => {
      cancelled = true;
      clearTimeout(readyTimer);
      clearTimeout(fallbackTimer);
    };
  }, []);

  useEffect(() => {
    if (!appReady || (!contentLaidOut && !fallbackElapsed)) return;
    hideNativeSplash(contentLaidOut ? 'content layout' : 'startup fallback');
  }, [appReady, contentLaidOut, fallbackElapsed]);

  const onReadyLayout = useCallback(() => {
    setContentLaidOut(true);
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AppSettingsProvider>
        <AppShell onReadyLayout={onReadyLayout} />
      </AppSettingsProvider>
    </GestureHandlerRootView>
  );
}
