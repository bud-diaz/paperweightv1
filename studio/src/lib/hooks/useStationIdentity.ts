import { useQuery } from '@tanstack/react-query';

import * as api from '@/lib/api';

type HealthStatus = { station: string };

// Shared across views (Overview, AppShell sidebar/header, etc.) — react-query
// dedupes identical query keys, so this is a single network request no
// matter how many components call the hook.
export function useStationIdentity() {
  const { data } = useQuery<HealthStatus>({ queryKey: ['stream', 'health'], queryFn: () => api.stream.health() });
  return { stationName: data?.station || 'Station' };
}
