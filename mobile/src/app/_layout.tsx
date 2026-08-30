import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { PlayerEngineProvider } from '@/player/PlayerEngineContext';
import { StashProvider } from '@/stash/StashContext';
import { StationStoreProvider } from '@/state/stationStore';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <StationStoreProvider>
          <PlayerEngineProvider>
            <StashProvider>
              <Stack screenOptions={{ headerShown: false }}>
                <Stack.Screen name="(tabs)" />
                <Stack.Screen
                  name="listener-login"
                  options={{ presentation: 'modal', headerShown: true, title: 'Listener Login' }}
                />
                <Stack.Screen name="project/[id]" options={{ headerShown: true, title: 'Collection' }} />
              </Stack>
            </StashProvider>
          </PlayerEngineProvider>
        </StationStoreProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
