import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useColorScheme } from 'react-native';

import { StationStoreProvider } from '@/state/stationStore';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <StationStoreProvider>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="listener-login"
            options={{ presentation: 'modal', headerShown: true, title: 'Listener Login' }}
          />
        </Stack>
      </StationStoreProvider>
    </ThemeProvider>
  );
}
