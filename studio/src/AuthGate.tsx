import { useState } from 'react';

import { AppShell } from '@/AppShell';
import { ListenerShell } from '@/ListenerShell';
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

// AuthGate serves two audiences off the same route, matching how
// client/creator.html always worked: the creator's own dashboard session
// (Overview/Releases/Vault/etc., plus their own Stack/Play preview) versus
// everyone else — anonymous, free, or paid listeners — who get the public
// player/catalog shell instead of a login prompt. `showDashboardLogin` is the
// public shell's own opt-in path back to the creator login (its "Studio" tab
// in ModeSwitcher), not something a visitor lands on by default.
export function AuthGate() {
  const { status, ready } = useDashboardAuth();
  const [showDashboardLogin, setShowDashboardLogin] = useState(false);

  if (!ready || status === 'checking') return <LoadingScreen />;
  if (status === 'needs2fa' || (status === 'anonymous' && showDashboardLogin)) return <DashboardLogin />;

  if (status === 'anonymous') {
    return <ListenerShell onRequestDashboardLogin={() => setShowDashboardLogin(true)} />;
  }

  return (
    <LaunchAcceptanceGate>
      <ListenerAuthProvider>
        <AppShell />
      </ListenerAuthProvider>
    </LaunchAcceptanceGate>
  );
}
