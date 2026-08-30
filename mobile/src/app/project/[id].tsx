import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ProjectDetailScreen } from '@/screens/ProjectDetailScreen';

export default function ProjectDetailRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
      <ProjectDetailScreen projectId={Number(id)} />
    </SafeAreaView>
  );
}
