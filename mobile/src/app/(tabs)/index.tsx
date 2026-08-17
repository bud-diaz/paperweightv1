import { SafeAreaView } from 'react-native-safe-area-context';

import { DiscoverScreen } from '@/screens/DiscoverScreen';

export default function DiscoverTab() {
  return (
    <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
      <DiscoverScreen />
    </SafeAreaView>
  );
}
