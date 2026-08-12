import { useState } from 'react';
import { Check, ChevronRight } from 'lucide-react';

import { Logo } from '@/components/Logo';
import { PostsTicker } from '@/components/PostsTicker';
import { ModeSwitcher } from '@/components/primitives';
import { ListenerAuthProvider } from '@/lib/auth/ListenerAuthContext';
import { usePlayerEngine } from '@/lib/hooks/usePlayerEngine';
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
  const { stationName } = useStationIdentity();
  const engine = usePlayerEngine();

  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(''), 2800); };

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
    notify('That feature is wired in a later pass.');
  };

  return (
    <div className="studio-app noise min-h-[100dvh] listening-shell">
      <audio ref={engine.audioRef} hidden />
      <main className="min-h-[100dvh] mode-main">
        <header className="h-20 px-4 sm:px-8 lg:px-10 border-b border-white/[.07] flex items-center gap-4 sticky top-0 z-30 glass-header">
          <Logo size={28} />
          <ModeSwitcher mode={mode} onChange={handleModeChange} />
          <div className="hidden lg:flex items-center gap-2 text-xs text-muted-foreground"><span>{stationName}</span><ChevronRight size={13} /><span className="text-foreground">{mode === 'stack' ? 'Library' : 'Player'}</span></div>
        </header>
        <div className="p-5 sm:p-8 lg:p-10 max-w-[1480px] mx-auto mode-content pb-24">
          {mode === 'stack' ? <StackView engine={engine} onOpen={handleOpen} onNotify={notify} /> : <PlayerView engine={engine} onOpen={handleOpen} onNotify={notify} />}
        </div>
      </main>
      <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[80] w-[min(90vw,420px)]"><PostsTicker /></div>
      {toast && <div data-testid="status-toast" className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[90] panel rounded-xl px-4 py-3 text-sm flex items-center gap-2 shadow-2xl animate-enter"><Check size={15} className="text-primary" /> {toast}</div>}
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
