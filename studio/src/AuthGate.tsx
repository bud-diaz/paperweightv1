import { AppShell } from '@/AppShell';
import { ListenerShell } from '@/ListenerShell';
import { useDashboardAuth } from '@/lib/auth/DashboardAuthContext';
import { ListenerAuthProvider } from '@/lib/auth/ListenerAuthContext';
import { LaunchAcceptanceGate } from '@/views/auth/LaunchAcceptance';

function LoadingScreen() {
  return (
    <div className="studio-app noise min-h-[100dvh] flex items-center justify-center">
      <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
    </div>
  );
}

// AuthGate serves two audiences off the same route, matching how
// client/creator.html always worked: the creator's own dashboard session
// (Overview/Releases/Vault/etc., plus their own Stack/Play preview) versus
// everyone else — anonymous, free, or paid listeners — who get the public
// player/catalog shell instead of a login prompt. The public shell's own
// opt-in path back to the creator login (its "Studio" tab in ModeSwitcher)
// renders DashboardLogin as an overlay on top of itself (see ListenerShell),
// so it stays mounted underneath — live audio and the last-selected tab
// survive dismissing the login overlay, and `needs2fa` (reached only via
// that overlay's own token submission) is handled the same way.
export function AuthGate() {
  const { status, ready } = useDashboardAuth();

  if (!ready || status === 'checking') return <LoadingScreen />;

  if (status === 'anonymous' || status === 'needs2fa') {
    return <ListenerShell />;
  }

  return (
    <LaunchAcceptanceGate>
      <ListenerAuthProvider>
        <AppShell />
      </ListenerAuthProvider>
    </LaunchAcceptanceGate>
  );
}
