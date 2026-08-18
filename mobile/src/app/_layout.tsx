import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import { LogBox } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { PlayerEngineProvider } from '@/player/PlayerEngine';
import { StationStoreProvider } from '@/state/stationStore';
import { StudioStoreProvider } from '@/state/studioStore';

if (__DEV__) {
  // Expo Go can't run our expo-audio config plugin (no prebuild step), so
  // it has no Android media-session service to bind lock-screen controls
  // to — these two messages are expected there and don't indicate a real
  // bug. They should not fire at all in a real dev-client/production build,
  // where the plugin actually ran; if they do turn up there, that's a real
  // regression worth un-ignoring this for.
  LogBox.ignoreLogs([
    'Failed to activate lock screen controls',
    'Failed to start the expo-audio playback service',
    'Cannot update lock screen metadata',
  ]);
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/* Dark is the only theme for now — see hooks/use-theme.ts. */}
      <ThemeProvider value={DarkTheme}>
        <StationStoreProvider>
          <StudioStoreProvider>
            <PlayerEngineProvider>
              <BottomSheetModalProvider>
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
                    options={{ presentation: 'modal', headerShown: true, title: 'Account' }}
                  />
                </Stack>
              </BottomSheetModalProvider>
            </PlayerEngineProvider>
          </StudioStoreProvider>
        </StationStoreProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
