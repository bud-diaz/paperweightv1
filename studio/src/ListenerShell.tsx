import { useEffect, useState } from 'react';
import { Check, ChevronRight, UserRound } from 'lucide-react';

import { AccountModal } from '@/components/AccountModal';
import { CheckoutModal } from '@/components/CheckoutModal';
import { EmailLinkHandler } from '@/components/EmailLinkHandler';
import { FloatingTipButton } from '@/components/FloatingTipButton';
import { Logo } from '@/components/Logo';
import { PostsTicker } from '@/components/PostsTicker';
import { IconButton, ModeSwitcher } from '@/components/primitives';
import { SettingsTour } from '@/components/SettingsTour';
import { VaultGateModal } from '@/components/VaultGateModal';
import { isWelcomeDismissed, markWelcomeDismissed, WelcomeOverlay } from '@/components/WelcomeOverlay';
import { ListenerAuthProvider, useListenerAuth } from '@/lib/auth/ListenerAuthContext';
import { usePlayerEngine, type OnDemandTrack } from '@/lib/hooks/usePlayerEngine';
import { useStationIdentity } from '@/lib/hooks/useStationIdentity';
import { PlayerView } from '@/views/PlayerView';
import { StackView } from '@/views/StackView';
import type { ModalKey, ModeKey } from '@/types';

// The public listener experience — anonymous, free, or paid visitors, none
// of whom hold a dashboard session. Deliberately a separate, much smaller
// shell than AppShell: no sidebar, no creator-only nav groups or modals,
// just the station player and catalog browser. Reuses StackView/PlayerView
// (also used by the creator's own Stack/Play mode-switcher inside AppShell)
// so both audiences see the same real playback and browsing behavior.
function ListenerApp({ onRequestDashboardLogin }: { onRequestDashboardLogin: () => void }) {
  const [mode, setMode] = useState<'stack' | 'play'>('play');
  const [toast, setToast] = useState('');
  const [accountModal, setAccountModal] = useState<{ tab: 'login' | 'register'; email?: string } | null>(null);
  const [checkoutModal, setCheckoutModal] = useState<{ tab?: 'tip' | 'subscribe' | 'all-access'; thankYou?: boolean } | null>(null);
  const [vaultGateTrack, setVaultGateTrack] = useState<OnDemandTrack | null>(null);
  const [welcomeDismissed, setWelcomeDismissed] = useState(isWelcomeDismissed());
  const { stationName } = useStationIdentity();
  const auth = useListenerAuth();
  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(''), 2800); };
  const engine = usePlayerEngine({ onNotify: notify });

  const openAccount = (tab: 'login' | 'register', email?: string) => setAccountModal({ tab, email });

  // Mirrors client/js/payment.js's handleTippedParam(): Stripe redirects here
  // with ?tipped=1 after a successful tip checkout.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('tipped')) return;
    params.delete('tipped');
    const clean = window.location.pathname + (params.toString() ? `?${params}` : '') + window.location.hash;
    window.history.replaceState(null, '', clean);
    setCheckoutModal({ thankYou: true });
  }, []);

  // Mirrors client/js/main.js's ?subscribed=1 handling: Stripe redirects here
  // after a checkout that creates/upgrades a listener account with no
  // password set yet. AccountModal already shows a "set a password" prompt
  // for any logged-in paid listener without one — this just opens it so
  // they see it right away instead of only on their next manual visit.
  useEffect(() => {
    if (!auth.ready) return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has('subscribed')) return;
    params.delete('subscribed');
    const clean = window.location.pathname + (params.toString() ? `?${params}` : '') + window.location.hash;
    window.history.replaceState(null, '', clean);
    if (auth.state.loggedIn && auth.state.tier !== 'free' && !auth.state.hasPassword) {
      setAccountModal({ tab: 'login' });
    }
  }, [auth.ready]);

  const handleLockedTrack = (track: OnDemandTrack) => {
    if (track.visibility === 'vault') { setVaultGateTrack(track); return; }
    if (track.visibility === 'supporters_only') { setCheckoutModal({ tab: 'subscribe' }); }
  };

  // Mirrors client/js/welcome.js's maybeShowWelcome(): once a visitor is
  // known to be logged in, the welcome overlay never shows again on this
  // browser, even across a future logout.
  useEffect(() => {
    if (auth.ready && auth.state.loggedIn && !welcomeDismissed) {
      markWelcomeDismissed();
      setWelcomeDismissed(true);
    }
  }, [auth.ready, auth.state.loggedIn, welcomeDismissed]);

  const handleModeChange = (next: ModeKey) => {
    if (next === 'studio') { onRequestDashboardLogin(); return; }
    setMode(next);
  };

  const handleOpen = (modal: ModalKey) => {
    if (modal === 'share') {
      navigator.clipboard?.writeText(window.location.href).catch(() => undefined);
      notify('Station link copied.');
      return;
    }
    if (modal === 'support') { setCheckoutModal({}); return; }
    notify('That feature is wired in a later pass.');
  };

  return (
    <div className="studio-app noise min-h-[100dvh] listening-shell">
      <audio ref={engine.audioRef} hidden />
      <main className="min-h-[100dvh] mode-main">
        <header className="relative h-20 px-4 sm:px-8 lg:px-10 border-b border-white/[.07] flex items-center gap-4 sticky top-0 z-30 glass-header">
          <Logo size={28} />
          <div className="md:absolute md:left-1/2 md:-translate-x-1/2"><ModeSwitcher mode={mode} onChange={handleModeChange} /></div>
          <div className="hidden lg:flex items-center gap-2 text-xs text-muted-foreground"><span>{stationName}</span><ChevronRight size={13} /><span className="text-foreground">{mode === 'stack' ? 'Library' : 'Player'}</span></div>
          <div className="ml-auto"><IconButton label="Account" onClick={() => setAccountModal({ tab: 'login' })}><UserRound size={16} /></IconButton></div>
        </header>
        <div className="p-5 sm:p-8 lg:p-10 max-w-[1480px] mx-auto mode-content pb-24">
          {mode === 'stack' ? <StackView engine={engine} onOpen={handleOpen} onNotify={notify} onLockedTrack={handleLockedTrack} onVideoTrackSelected={() => setMode('play')} /> : <PlayerView engine={engine} onOpen={handleOpen} onNotify={notify} />}
        </div>
      </main>
      <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[80] w-[min(90vw,420px)]"><PostsTicker /></div>
      <FloatingTipButton onClick={() => setCheckoutModal({ tab: 'tip' })} />
      {toast && <div data-testid="status-toast" className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[90] panel rounded-xl px-4 py-3 text-sm flex items-center gap-2 shadow-2xl animate-enter"><Check size={15} className="text-primary" /> {toast}</div>}
      {!welcomeDismissed && auth.ready && !auth.state.loggedIn && (
        <WelcomeOverlay
          stationName={stationName}
          onDismiss={() => setWelcomeDismissed(true)}
          onOpenLogin={(prefillEmail) => { setWelcomeDismissed(true); setAccountModal({ tab: 'login', email: prefillEmail }); }}
        />
      )}
      {accountModal && <AccountModal onClose={() => setAccountModal(null)} onNotify={notify} initialTab={accountModal.tab} initialEmail={accountModal.email} />}
      {checkoutModal && <CheckoutModal stationName={stationName} initialTab={checkoutModal.tab} thankYou={checkoutModal.thankYou} onClose={() => setCheckoutModal(null)} onNotify={notify} onOpenAccount={openAccount} />}
      {vaultGateTrack && <VaultGateModal track={vaultGateTrack} onClose={() => setVaultGateTrack(null)} onNotify={notify} onOpenAccount={openAccount} />}
      <EmailLinkHandler onNotify={notify} />
      <SettingsTour suppressed={!!accountModal} />
    </div>
  );
}

export function ListenerShell({ onRequestDashboardLogin }: { onRequestDashboardLogin: () => void }) {
  return (
    <ListenerAuthProvider>
      <ListenerApp onRequestDashboardLogin={onRequestDashboardLogin} />
    </ListenerAuthProvider>
  );
}
