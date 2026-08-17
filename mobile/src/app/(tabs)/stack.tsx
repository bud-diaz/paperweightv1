import { SafeAreaView } from 'react-native-safe-area-context';

import { StackScreen } from '@/screens/StackScreen';

export default function StackTab() {
  return (
    <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
      <StackScreen />
    </SafeAreaView>
  );
}
