import { ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/hooks/use-theme';
import { StudioGate } from '@/screens/StudioGate';
import { StudioHome } from '@/screens/studio/StudioHome';
import { useDashboardAuth } from '@/state/dashboardAuthStore';

export default function StudioScreen() {
  const colors = useTheme();
  const { hydrated, isPaired } = useDashboardAuth();

  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }}>
        {!hydrated ? (
          <ThemedView style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color={colors.accent} />
          </ThemedView>
        ) : isPaired ? (
          <StudioHome />
        ) : (
          <StudioGate />
        )}
      </SafeAreaView>
    </ThemedView>
  );
}
