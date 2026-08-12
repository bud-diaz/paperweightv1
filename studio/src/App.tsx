import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import Share from '@/pages/Share';
import { AuthGate } from '@/AuthGate';
import { DashboardAuthProvider } from '@/lib/auth/DashboardAuthContext';

const queryClient = new QueryClient();

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

// The fallback route (no `path`, matches anything not matched above) renders
// AuthGate rather than a 404 page — this mirrors the Express catch-all in
// src/index.js, which serves this same index.html for any non-API/non-hls
// path, including old bookmarks to /creator.html or /studio. There is no
// client-side deep linking within the dashboard/listener app itself (nav is
// state-driven, not route-driven — see AppShell/ListenerShell), so any path
// other than /share/:token should just render the normal app shell, exactly
// like creator.html always did before this router existed.
function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/share/:token" component={Share} />
        <Route component={AuthGate} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <DashboardAuthProvider>
        <TooltipProvider>
          <WouterRouter>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </DashboardAuthProvider>
    </QueryClientProvider>
  );
}
