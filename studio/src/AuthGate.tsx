import { AppShell } from '@/AppShell';
import { useDashboardAuth } from '@/lib/auth/DashboardAuthContext';
import { ListenerAuthProvider } from '@/lib/auth/ListenerAuthContext';
import { DashboardLogin } from '@/views/auth/DashboardLogin';
import { LaunchAcceptanceGate } from '@/views/auth/LaunchAcceptance';

function LoadingScreen() {
  return (
    <div className="studio-app noise min-h-[100dvh] flex items-center justify-center">
      <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
    </div>
  );
}

// Everything under /studio is the creator's own workspace (dashboard, plus
// the Stack/Play "own library and player" modes) — there is no anonymous
// public view here yet, so a single dashboard-session gate covers the whole
// app. The real public listener experience stays on the untouched
// client/creator.html until Phase 3 designs where it lives in this new UI.
export function AuthGate() {
  const { status, ready } = useDashboardAuth();

  if (!ready || status === 'checking') return <LoadingScreen />;
  if (status === 'anonymous' || status === 'needs2fa') return <DashboardLogin />;

  return (
    <LaunchAcceptanceGate>
      <ListenerAuthProvider>
        <AppShell />
      </ListenerAuthProvider>
    </LaunchAcceptanceGate>
  );
}
