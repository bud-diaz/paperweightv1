import { useEffect, useState } from 'react';

import { Modal } from '@/components/primitives';
import * as api from '@/lib/api';
import { useListenerAuth } from '@/lib/auth/ListenerAuthContext';
import type { OnDemandTrack } from '@/lib/hooks/usePlayerEngine';

type PriceOption = { minimumPrice: number; allowFree: boolean; paymentType: 'one_time' | 'recurring'; recurringInterval?: string | null; name?: string };
type UnlockOptions = { track?: PriceOption; project?: PriceOption; allAccess?: PriceOption };

function formatPrice(p: PriceOption) {
  return p.allowFree ? 'Free' : `$${(p.minimumPrice / 100).toFixed(2)}`;
}
function formatSub(p: PriceOption, extra?: string) {
  const cadence = p.paymentType === 'recurring' ? `per ${p.recurringInterval || 'month'}` : 'one-time';
  return extra ? `${extra} · ${cadence}` : cadence;
}

// Ports client/js/payment.js's checkVaultGate()/_showVaultGate()/
// startVaultUnlock(): fetches this track's real unlock options (its own
// price, its collection's price, an all-access pass) and initiates whichever
// checkout the listener picks.
export function VaultGateModal({ track, onClose, onNotify, onOpenAccount }: { track: OnDemandTrack; onClose: () => void; onNotify: (message: string) => void; onOpenAccount: (tab: 'login' | 'register', email?: string) => void }) {
  const { state } = useListenerAuth();
  const [options, setOptions] = useState<UnlockOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.payment.vaultUnlockOptions(track.id).then((d: { isVault: boolean; alreadyUnlocked: boolean; unlockOptions?: UnlockOptions }) => {
      if (cancelled) return;
      if (!d.isVault || d.alreadyUnlocked) { onClose(); return; }
      setOptions(d.unlockOptions || {});
      setLoading(false);
      api.events.record('vault_gate_viewed', { mediaId: track.id, source: 'library' });
    }).catch(() => { if (!cancelled) onClose(); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track.id]);

  async function unlock(key: string, unlockType: 'track' | 'project' | 'all_access', targetId: number | null, price: PriceOption) {
    setPendingKey(key);
    try {
      const data = await api.payment.vaultUnlock({
        unlock_type: unlockType,
        target_id: targetId || undefined,
        amount: price.minimumPrice,
        payment_type: price.paymentType,
        recurring_interval: price.recurringInterval || undefined,
      }) as { action?: string; checkoutUrl?: string; error?: string };
      if (data.action === 'signup') { onClose(); onOpenAccount('register'); return; }
      if (data.checkoutUrl) { window.location.href = data.checkoutUrl; return; }
      onNotify(data.error || 'Could not start checkout.');
    } catch {
      onNotify('Network error — please try again.');
    }
    setPendingKey(null);
  }

  async function subscribe() {
    setPendingKey('subscribe');
    try {
      const data = await api.payment.checkoutUrl() as { checkoutUrl?: string };
      if (data.checkoutUrl) { window.location.href = data.checkoutUrl; return; }
    } catch { /* fall through to reset */ }
    onNotify('Could not start checkout.');
    setPendingKey(null);
  }

  return <Modal title={track.title} eyebrow="Vault / Unlock" onClose={onClose}>
    {loading ? <p className="text-sm text-muted-foreground py-6 text-center">Loading options…</p> : <div className="space-y-3">
      {options?.track && <button type="button" data-testid="button-unlock-track" disabled={!!pendingKey} onClick={() => unlock('track', 'track', track.id, options.track!)} className="w-full panel-subtle rounded-xl p-4 flex items-center justify-between text-left disabled:opacity-50">
        <div><p className="text-sm font-medium">This track</p><p className="text-xs text-muted-foreground mt-1">{formatSub(options.track)}</p></div>
        <span className="font-mono-ui text-sm text-primary">{pendingKey === 'track' ? '…' : formatPrice(options.track)}</span>
      </button>}
      {options?.project && <button type="button" data-testid="button-unlock-project" disabled={!!pendingKey} onClick={() => unlock('project', 'project', null, options.project!)} className="w-full panel-subtle rounded-xl p-4 flex items-center justify-between text-left disabled:opacity-50">
        <div><p className="text-sm font-medium">Full collection</p><p className="text-xs text-muted-foreground mt-1">{formatSub(options.project, options.project.name)}</p></div>
        <span className="font-mono-ui text-sm text-primary">{pendingKey === 'project' ? '…' : formatPrice(options.project)}</span>
      </button>}
      {options?.allAccess && <button type="button" data-testid="button-unlock-all-access" disabled={!!pendingKey} onClick={() => unlock('all-access', 'all_access', null, options.allAccess!)} className="w-full panel-subtle rounded-xl p-4 flex items-center justify-between text-left disabled:opacity-50">
        <div><p className="text-sm font-medium">All-access pass</p><p className="text-xs text-muted-foreground mt-1">{formatSub(options.allAccess)}</p></div>
        <span className="font-mono-ui text-sm text-primary">{pendingKey === 'all-access' ? '…' : formatPrice(options.allAccess)}</span>
      </button>}
      <button type="button" data-testid="button-unlock-subscribe" disabled={!!pendingKey} onClick={subscribe} className="w-full ghost-button rounded-xl p-4 flex items-center justify-between text-left disabled:opacity-50">
        <div><p className="text-sm font-medium">Subscriber</p><p className="text-xs text-muted-foreground mt-1">Unlocks all supporters content</p></div>
        <span className="text-xs text-muted-foreground">{pendingKey === 'subscribe' ? '…' : 'Support the station'}</span>
      </button>
      {!state.hasAccount && <p className="text-xs text-muted-foreground text-center pt-2">
        {state.loggedIn ? <button type="button" data-testid="button-vault-gate-complete-account" onClick={() => { onClose(); onOpenAccount('register'); }} className="text-primary">Complete your account to buy this track</button>
          : <>Already have an account? <button type="button" data-testid="button-vault-gate-login" onClick={() => { onClose(); onOpenAccount('login'); }} className="text-primary">Log in</button></>}
      </p>}
    </div>}
  </Modal>;
}
