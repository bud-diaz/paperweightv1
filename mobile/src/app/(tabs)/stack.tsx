import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedView } from '@/components/themed-view';
import { PlaceholderScreen } from '@/components/PlaceholderScreen';

export default function StackScreen() {
  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }}>
        <PlaceholderScreen
          title="Stack"
          body="Station catalog and the cross-station on-device Stash land in Phase 4."
        />
      </SafeAreaView>
    </ThemedView>
  );
}
