import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { PlayerEngineProvider } from '@/player/PlayerEngineContext';
import { StashProvider } from '@/stash/StashContext';
import { AppSettingsProvider, useAppSettings } from '@/state/appSettingsStore';
import { DashboardAuthProvider } from '@/state/dashboardAuthStore';
import { StationStoreProvider } from '@/state/stationStore';

function AppShell() {
  const systemScheme = useColorScheme();
  const { themeMode } = useAppSettings();
  const effectiveScheme = themeMode === 'system' ? systemScheme : themeMode;

  return (
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
            </DashboardAuthProvider>
          </StashProvider>
        </PlayerEngineProvider>
      </StationStoreProvider>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AppSettingsProvider>
        <AppShell />
      </AppSettingsProvider>
    </GestureHandlerRootView>
  );
}
