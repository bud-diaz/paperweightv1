import { SafeAreaView } from 'react-native-safe-area-context';

import { PlayScreen } from '@/screens/PlayScreen';

export default function PlayTab() {
  return (
    <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
      <PlayScreen />
    </SafeAreaView>
  );
}
