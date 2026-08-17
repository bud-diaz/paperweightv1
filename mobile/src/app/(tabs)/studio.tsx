import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedView } from '@/components/themed-view';
import { PlaceholderScreen } from '@/components/PlaceholderScreen';

export default function StudioScreen() {
  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }}>
        <PlaceholderScreen
          title="Studio"
          body="QR device pairing and the curated essentials screens land in Phase 5."
        />
      </SafeAreaView>
    </ThemedView>
  );
}
