import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';

import { Field, Modal } from '@/components/primitives';
import * as api from '@/lib/api';
import { cn } from '@/lib/utils';

type Tab = 'tip' | 'subscribe' | 'all-access';

// Ports client/js/payment.js's support modal (tip/subscribe/all-access) and
// its ?tipped=1 Stripe-redirect thank-you state. All three tabs redirect to
// a real Stripe Checkout session — subscribe/all-access both call
// GET /api/payment/checkout-url, which (pre-existing backend behavior, not
// something this migration changes) always prices at the subscriber tier
// regardless of which tab requested it; the only way to actually buy
// all-access at its configured price is the vault-unlock flow.
export function CheckoutModal({ stationName, initialTab, thankYou, onClose, onNotify, onOpenAccount }: {
  stationName: string;
  initialTab?: Tab;
  thankYou?: boolean;
  onClose: () => void;
  onNotify: (message: string) => void;
  onOpenAccount: (tab: 'login' | 'register', email?: string) => void;
}) {
  const [tab, setTab] = useState<Tab>(initialTab || 'tip');
  const [amounts, setAmounts] = useState<number[]>([300, 500, 1000]);
  const [selectedCents, setSelectedCents] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState('');
  const [donorName, setDonorName] = useState('');
  const [donorEmail, setDonorEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.payment.tipConfig().then((cfg: { enabled: boolean; amounts?: number[] }) => {
      if (cfg.enabled && cfg.amounts?.length) setAmounts(cfg.amounts);
    }).catch(() => undefined);
  }, []);

  async function handleCta() {
    setError(null);
    if (tab === 'tip') {
      const cents = selectedCents || (parseFloat(customAmount) > 0 ? Math.round(parseFloat(customAmount) * 100) : 0);
      if (!cents || cents < 100) { setError('Enter an amount of at least $1.'); return; }
      setPending(true);
      const { res, data } = await api.payment.sendTip(cents, { donorName: donorName.trim(), donorEmail: donorEmail.trim() }) as { res: Response; data: { checkoutUrl?: string; error?: string } };
      if (!res.ok) { setPending(false); setError(data.error || 'Payment failed.'); return; }
      window.location.href = data.checkoutUrl!;
      return;
    }
    const tier = tab === 'all-access' ? 'all_access' : 'subscriber';
    setPending(true);
    try {
      const data = await api.payment.checkoutUrl(tier) as { checkoutUrl?: string; error?: string };
      if (!data.checkoutUrl) { setPending(false); setError(data.error || 'Something went wrong.'); return; }
      window.location.href = data.checkoutUrl;
    } catch {
      setPending(false);
      setError('Network error — please try again.');
    }
  }

  if (thankYou) {
    return <Modal title="Thank you." eyebrow="Support" onClose={onClose}>
      <div className="text-center py-4">
        <Check size={28} className="text-primary mx-auto" />
        <p className="text-sm text-muted-foreground mt-4">{stationName ? `Your support keeps ${stationName} independent.` : 'Your support is appreciated.'}</p>
        <button type="button" data-testid="button-checkout-create-account" onClick={() => { onClose(); onOpenAccount('register'); }} className="ghost-button rounded-lg px-4 py-2 text-xs mt-6">Create a free account to save your access</button>
      </div>
    </Modal>;
  }

  const ctaLabel = tab === 'tip'
    ? (selectedCents || customAmount ? `Send $${((selectedCents ?? Math.round((parseFloat(customAmount) || 0) * 100)) / 100).toFixed(2)} tip` : 'Send tip')
    : tab === 'subscribe' ? 'Subscribe' : 'Get all-access';

  return <Modal title={stationName ? `Support ${stationName}` : 'Support this station'} eyebrow="Support" onClose={onClose}>
    <div className="grid grid-cols-3 gap-2 mb-6 panel-subtle rounded-xl p-1">
      <button type="button" data-testid="tab-tip" onClick={() => setTab('tip')} className={cn('rounded-lg py-2 text-xs font-semibold', tab === 'tip' ? 'bg-primary text-black' : 'text-muted-foreground')}>Tip</button>
      <button type="button" data-testid="tab-subscribe" onClick={() => setTab('subscribe')} className={cn('rounded-lg py-2 text-xs font-semibold', tab === 'subscribe' ? 'bg-primary text-black' : 'text-muted-foreground')}>Subscribe</button>
      <button type="button" data-testid="tab-all-access" onClick={() => setTab('all-access')} className={cn('rounded-lg py-2 text-xs font-semibold', tab === 'all-access' ? 'bg-primary text-black' : 'text-muted-foreground')}>All-access</button>
    </div>

    {tab === 'tip' ? <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        {amounts.map((cents) => <button type="button" key={cents} data-testid={`button-tip-preset-${cents}`} onClick={() => { setSelectedCents(cents); setCustomAmount(''); }} className={cn('rounded-lg py-2.5 text-sm font-semibold panel-subtle', selectedCents === cents && 'ring-1 ring-primary text-primary')}>{cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`}</button>)}
      </div>
      <Field label="Custom amount ($)" value={customAmount} onChange={(value) => { setCustomAmount(value); setSelectedCents(null); }} placeholder="0.00" />
      <Field label="Your name (optional)" value={donorName} onChange={setDonorName} placeholder="Anonymous" />
      <Field label="Your email (optional)" value={donorEmail} onChange={setDonorEmail} placeholder="you@example.com" />
      <p className="text-xs text-muted-foreground">Leave both blank to tip anonymously. Adding your email grants 7 days of supporter access.</p>
    </div> : tab === 'subscribe' ? <p className="text-sm text-muted-foreground">Monthly support that unlocks supporters-only tracks and posts.</p> : <p className="text-sm text-muted-foreground">The complete private archive, at the creator's all-access price.</p>}

    {error && <p className="text-xs text-destructive mt-4">{error}</p>}

    <button type="button" data-testid="button-checkout-cta" onClick={handleCta} disabled={pending} className="lime-button rounded-lg px-4 py-2.5 text-sm font-semibold w-full mt-6 disabled:opacity-50">{pending ? 'Connecting to Stripe…' : ctaLabel}</button>
  </Modal>;
}
