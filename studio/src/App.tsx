import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { AppShell } from '@/AppShell';

const queryClient = new QueryClient();

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={AppShell} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

// Wouter's `base` is the browser URL prefix the app is mounted at (the
// Express route in src/index.js that serves this build's index.html) — not
// to be confused with Vite's asset `base` in vite.config.ts, which is the
// separate on-disk path (/app/) the built JS/CSS bundle files live under.
const ROUTER_BASE = '/studio';

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={ROUTER_BASE}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
