import { SafeAreaView } from 'react-native-safe-area-context';

import { StudioScreen } from '@/screens/StudioScreen';

export default function StudioTab() {
  return (
    <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
      <StudioScreen />
    </SafeAreaView>
  );
}
