import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedView } from '@/components/themed-view';
import { PlaceholderScreen } from '@/components/PlaceholderScreen';

export default function PlayScreen() {
  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }}>
        <PlaceholderScreen
          title="Play"
          body="Live/on-demand playback, the sticky transport, and the drawer land in Phase 3."
        />
      </SafeAreaView>
    </ThemedView>
  );
}
