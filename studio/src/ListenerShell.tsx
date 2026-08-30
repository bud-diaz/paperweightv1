import { useEffect, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { Check, ChevronRight, Copy, Globe2, Mail, Music2, Share2, UserRound } from 'lucide-react';

import { AccountModal } from '@/components/AccountModal';
import { CheckoutModal } from '@/components/CheckoutModal';
import { EmailLinkHandler } from '@/components/EmailLinkHandler';
import { Logo } from '@/components/Logo';
import { PostsTicker } from '@/components/PostsTicker';
import { IconButton, Modal, ModeSwitcher } from '@/components/primitives';
import { SettingsTour } from '@/components/SettingsTour';
import { StickyTransport } from '@/components/StickyTransport';
import { VaultGateModal } from '@/components/VaultGateModal';
import { isWelcomeDismissed, markWelcomeDismissed, WelcomeOverlay } from '@/components/WelcomeOverlay';
import { useDashboardAuth } from '@/lib/auth/DashboardAuthContext';
import { ListenerAuthProvider, useListenerAuth } from '@/lib/auth/ListenerAuthContext';
import { usePlayerEngine, type OnDemandTrack } from '@/lib/hooks/usePlayerEngine';
import { useStationIdentity } from '@/lib/hooks/useStationIdentity';
import { DashboardLogin } from '@/views/auth/DashboardLogin';
import { PlayerView } from '@/views/PlayerView';
import { StackView } from '@/views/StackView';
import type { ModalKey, ModeKey } from '@/types';

// The public listener experience — anonymous, free, or paid visitors, none
// of whom hold a dashboard session. Deliberately a separate, much smaller
// shell than AppShell: no sidebar, no creator-only nav groups or modals,
// just the station player and catalog browser. Reuses StackView/PlayerView
// (also used by the creator's own Stack/Play mode-switcher inside AppShell)
// so both audiences see the same real playback and browsing behavior.
function ListenerApp() {
  const [mode, setMode] = useState<'stack' | 'play'>('play');
  const [toast, setToast] = useState('');
  const [accountModal, setAccountModal] = useState<{ tab: 'login' | 'register'; email?: string } | null>(null);
  const [checkoutModal, setCheckoutModal] = useState<{ tab?: 'tip' | 'subscribe' | 'all-access'; thankYou?: boolean } | null>(null);
  const [vaultGateTrack, setVaultGateTrack] = useState<OnDemandTrack | null>(null);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [welcomeDismissed, setWelcomeDismissed] = useState(isWelcomeDismissed());
  const [showDashboardLogin, setShowDashboardLogin] = useState(false);
  const [playButtonVisible, setPlayButtonVisible] = useState(true);
  const { stationName } = useStationIdentity();
  const auth = useListenerAuth();
  const dashboardAuth = useDashboardAuth();
  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(''), 2800); };
  const engine = usePlayerEngine({ onNotify: notify });

  // A fresh 2FA challenge (only reachable from inside the overlay's own
  // token submission) should always surface the overlay, even if it was
  // dismissed to the backdrop mid-flow — see handleModeChange/DashboardLogin.
  useEffect(() => {
    if (dashboardAuth.status === 'needs2fa') setShowDashboardLogin(true);
  }, [dashboardAuth.status]);

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
    if (next === 'studio') { setShowDashboardLogin(true); return; }
    setMode(next);
  };

  const handleOpen = (modal: ModalKey) => {
    if (modal === 'share') { setShareModalOpen(true); return; }
    if (modal === 'support') { setCheckoutModal({}); return; }
    notify('That feature is wired in a later pass.');
  };

  const shareUrl = window.location.href;
  const shareText = `${stationName} — listen on Paperweight`;
  const copyShareLink = async () => {
    try {
      if (!navigator.clipboard) throw new Error('Clipboard API unavailable');
      await navigator.clipboard.writeText(shareUrl);
      notify('Station link copied.');
    } catch {
      notify('Copy failed — select the link and copy it manually.');
    }
  };
  const openNativeShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: stationName, text: shareText, url: shareUrl });
        return;
      } catch (error) {
        if ((error as DOMException)?.name === 'AbortError') return;
      }
    }
    await copyShareLink();
  };

  const shareModal = shareModalOpen ? (
    <Modal title="Share this station." eyebrow="Share" onClose={() => setShareModalOpen(false)}>
      <div className="panel-subtle rounded-xl p-5">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-xl flex items-center justify-center bg-primary">
            <Music2 size={19} className="text-primary-foreground" />
          </div>
          <div className="min-w-0">
            <p className="font-medium truncate">{stationName}</p>
            <p className="text-xs text-muted-foreground mt-1">Public listening link</p>
          </div>
        </div>
        <div className="mt-5 flex gap-2 rounded-xl border border-white/[.08] bg-black/20 p-2">
          <input readOnly value={shareUrl} data-testid="input-share-link" onFocus={(event) => event.currentTarget.select()} className="min-w-0 flex-1 bg-transparent px-2 text-xs text-muted-foreground outline-none" />
          <button type="button" data-testid="button-copy-share-link" onClick={copyShareLink} className="lime-button rounded-lg px-3 py-2 text-xs font-semibold flex items-center gap-2">
            <Copy size={14} /> Copy
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 mt-5">
        <button type="button" data-testid="button-native-share" onClick={openNativeShare} className="ghost-button rounded-xl py-3 text-sm flex items-center justify-center gap-2"><Share2 size={15} /> Share sheet</button>
        <a data-testid="button-share-email" href={`mailto:?subject=${encodeURIComponent(shareText)}&body=${encodeURIComponent(shareUrl)}`} className="ghost-button rounded-xl py-3 text-sm flex items-center justify-center gap-2"><Mail size={15} /> Email</a>
      </div>
      <div className="mt-6 flex items-center justify-between text-xs text-muted-foreground"><span>Public sharing</span><span className="text-primary flex items-center gap-1"><Globe2 size={13} /> On</span></div>
    </Modal>
  ) : null;

  return (
    <div className="studio-app noise min-h-[100dvh] listening-shell">
      <audio ref={engine.audioRef} hidden />
      <main className="min-h-[100dvh] mode-main">
        <header className="relative h-20 px-4 sm:px-8 lg:px-10 border-b border-white/[.07] flex items-center gap-4 sticky top-0 z-30 glass-header">
          <a href="https://paperweighthq.com" target="_blank" rel="noopener noreferrer"><Logo size={49} /></a>
          <div className="absolute left-1/2 -translate-x-1/2"><ModeSwitcher mode={mode} onChange={handleModeChange} /></div>
          <div className="hidden lg:flex items-center gap-2 text-xs text-muted-foreground"><span>{stationName}</span><ChevronRight size={13} /><span className="text-foreground">{mode === 'stack' ? 'Library' : 'Player'}</span></div>
          <div className="ml-auto"><IconButton label="Account" onClick={() => setAccountModal({ tab: 'login' })}><UserRound size={16} /></IconButton></div>
        </header>
        <div className="p-5 sm:p-8 lg:p-10 max-w-[1480px] mx-auto mode-content pb-24">
          {mode === 'stack' ? <StackView engine={engine} onOpen={handleOpen} onNotify={notify} onLockedTrack={handleLockedTrack} onVideoTrackSelected={() => setMode('play')} /> : <PlayerView engine={engine} onOpen={handleOpen} onNotify={notify} onPlayButtonVisibilityChange={setPlayButtonVisible} />}
        </div>
      </main>
      <StickyTransport engine={engine} visible={mode !== 'play' || !playButtonVisible} onTip={() => setCheckoutModal({ tab: 'tip' })} onNotify={notify} />
      <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[80] w-[min(90vw,420px)]"><PostsTicker /></div>
      {toast && <div data-testid="status-toast" className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[90] panel rounded-xl px-4 py-3 text-sm flex items-center gap-2 shadow-2xl animate-enter"><Check size={15} className="text-primary" /> {toast}</div>}
      {!welcomeDismissed && auth.ready && !auth.state.loggedIn && (
        <WelcomeOverlay
          stationName={stationName}
          onDismiss={() => setWelcomeDismissed(true)}
          onOpenLogin={(prefillEmail) => { setWelcomeDismissed(true); setAccountModal({ tab: 'login', email: prefillEmail }); }}
        />
      )}
      <AnimatePresence>{accountModal && <AccountModal onClose={() => setAccountModal(null)} onNotify={notify} initialTab={accountModal.tab} initialEmail={accountModal.email} />}</AnimatePresence>
      <AnimatePresence>{shareModal}</AnimatePresence>
      <AnimatePresence>{checkoutModal && <CheckoutModal stationName={stationName} initialTab={checkoutModal.tab} thankYou={checkoutModal.thankYou} onClose={() => setCheckoutModal(null)} onNotify={notify} onOpenAccount={openAccount} />}</AnimatePresence>
      <AnimatePresence>{vaultGateTrack && <VaultGateModal track={vaultGateTrack} onClose={() => setVaultGateTrack(null)} onNotify={notify} onOpenAccount={openAccount} />}</AnimatePresence>
      <EmailLinkHandler onNotify={notify} />
      <SettingsTour suppressed={!!accountModal} />
      <AnimatePresence>{showDashboardLogin && <DashboardLogin onClose={() => setShowDashboardLogin(false)} />}</AnimatePresence>
    </div>
  );
}

export function ListenerShell() {
  return (
    <ListenerAuthProvider>
      <ListenerApp />
    </ListenerAuthProvider>
  );
}
