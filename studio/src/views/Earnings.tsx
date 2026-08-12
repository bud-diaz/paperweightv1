import { useQuery } from '@tanstack/react-query';
import { Heart, LockKeyhole, Settings, Users } from 'lucide-react';

import { ViewHeader } from '@/components/primitives';
import * as api from '@/lib/api';
import type { ModalKey } from '@/types';

type Unlock = { unlockType: string; targetId: number; title: string; unitsSold: number; revenueCents: number };
type Tip = { amount_cents: number; created_at: string };
type Subscription = { tier: string; count: number; knownMonthlyCents: number };
type Earnings = {
  totals: {
    revenueCents: number; unlockRevenueCents: number; tipRevenueCents: number;
    todayRevenueCents: number; activeSubscriptions: number; knownMonthlyRecurringCents: number;
  };
  unlocks: Unlock[];
  tips: { count: number; grossCents: number; recent: Tip[] };
  subscriptions: Subscription[];
};

function formatCents(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export function Earnings({ onOpen, onNotify }: { onOpen: (modal: ModalKey) => void; onNotify: (message: string) => void }) {
  const { data, isLoading } = useQuery<Earnings>({ queryKey: ['dashboard', 'earnings'], queryFn: () => api.dashboard.earnings() });

  const totals = data?.totals;
  const breakdownTotal = (totals?.unlockRevenueCents ?? 0) + (totals?.tipRevenueCents ?? 0) + (totals?.knownMonthlyRecurringCents ?? 0);
  const pct = (cents: number) => (breakdownTotal ? Math.round((cents / breakdownTotal) * 100) : 0);

  return <div className="animate-enter">
    <ViewHeader eyebrow="Signal / Earnings" title="Make the work pay." description="A clean view of your listener support, tips, and streaming share." action={<button type="button" data-testid="button-payout-settings" onClick={() => onOpen('settings')} className="ghost-button rounded-xl px-4 py-2.5 text-sm flex items-center gap-2"><Settings size={15} /> Payment settings</button>} />
    <div className="grid lg:grid-cols-[1.2fr_.8fr] gap-6 mb-6">
      <section className="panel rounded-2xl p-6 sm:p-8 relative overflow-hidden">
        <div className="absolute -right-14 -top-14 w-56 h-56 rounded-full border border-primary/10" />
        <p className="font-mono-ui text-[10px] uppercase tracking-[.2em] text-muted-foreground">All-time revenue</p>
        <p className="font-display text-5xl sm:text-6xl font-semibold mt-4 signal-gradient">{isLoading ? '—' : formatCents(totals?.revenueCents ?? 0)}</p>
        <p className="text-sm text-muted-foreground mt-4">{formatCents(totals?.todayRevenueCents ?? 0)} today · {totals?.activeSubscriptions ?? 0} active subscriptions</p>
        <p className="text-[11px] text-muted-foreground mt-6 max-w-sm">Payments settle directly to your connected Stripe/PayPal account — Paperweight doesn't hold or route funds.</p>
      </section>
      <section className="panel rounded-2xl p-6">
        <p className="font-mono-ui text-[10px] uppercase tracking-[.2em] text-muted-foreground">Revenue mix</p>
        <h2 className="font-display text-2xl font-semibold mt-2">{formatCents(breakdownTotal)}</h2>
        <div className="space-y-4 mt-7">
          <div className="flex justify-between text-sm"><span className="text-muted-foreground">Vault unlocks</span><span>{formatCents(totals?.unlockRevenueCents ?? 0)}</span></div>
          <div className="flex justify-between text-sm"><span className="text-muted-foreground">Listener tips</span><span>{formatCents(totals?.tipRevenueCents ?? 0)}</span></div>
          <div className="flex justify-between text-sm"><span className="text-muted-foreground">Recurring subscriptions (monthly)</span><span>{formatCents(totals?.knownMonthlyRecurringCents ?? 0)}</span></div>
        </div>
        <div className="h-2 bg-white/[.07] rounded-full mt-7 overflow-hidden flex">
          <div className="h-full bg-primary" style={{ width: `${pct(totals?.unlockRevenueCents ?? 0)}%` }} />
          <div className="h-full bg-accent" style={{ width: `${pct(totals?.tipRevenueCents ?? 0)}%` }} />
          <div className="h-full bg-[#8193ff]" style={{ width: `${pct(totals?.knownMonthlyRecurringCents ?? 0)}%` }} />
        </div>
      </section>
    </div>
    <section className="panel rounded-2xl p-5 sm:p-6">
      <div className="flex items-center justify-between mb-5">
        <div><p className="font-mono-ui text-[10px] uppercase tracking-[.2em] text-muted-foreground">Support, your way</p><h2 className="font-display text-xl font-semibold mt-1">Turn attention into momentum.</h2></div>
        <button type="button" data-testid="button-configure-tips" onClick={() => onOpen('support')} className="lime-button rounded-lg px-3 py-2 text-xs font-semibold">Configure tips</button>
      </div>
      <div className="grid md:grid-cols-3 gap-3">
        <div className="panel-subtle rounded-xl p-4"><span className="text-primary"><Heart size={17} /></span><p className="font-medium text-sm mt-4">Tips</p><p className="text-xs text-muted-foreground mt-1">{data?.tips.count ?? 0} tips received</p><p className="font-mono-ui text-xs mt-4 text-primary">{formatCents(data?.tips.grossCents ?? 0)}</p></div>
        {(data?.subscriptions || []).map((sub) => (
          <div key={sub.tier} className="panel-subtle rounded-xl p-4"><span className="text-primary"><Users size={17} /></span><p className="font-medium text-sm mt-4 capitalize">{sub.tier.replace('_', ' ')}</p><p className="text-xs text-muted-foreground mt-1">{sub.count} active</p><p className="font-mono-ui text-xs mt-4 text-primary">{formatCents(sub.knownMonthlyCents)}/mo</p></div>
        ))}
        {!data?.subscriptions.length && <div className="panel-subtle rounded-xl p-4 text-xs text-muted-foreground flex items-center gap-2"><LockKeyhole size={14} /> No active subscriptions yet</div>}
      </div>
    </section>
    <section className="panel rounded-2xl p-5 sm:p-6 mt-6">
      <div className="flex items-center justify-between mb-3"><h2 className="font-display text-xl font-semibold">Top earners</h2></div>
      {data?.unlocks.length ? data.unlocks.slice(0, 8).map((unlock) => (
        <div key={`${unlock.unlockType}-${unlock.targetId}`} className="flex items-center py-4 border-b border-white/[.07] last:border-0 text-sm">
          <span className="flex-1 truncate">{unlock.title}</span>
          <span className="font-mono-ui text-xs text-muted-foreground mr-4">{unlock.unitsSold} unlock{unlock.unitsSold === 1 ? '' : 's'}</span>
          <span className="font-mono-ui">{formatCents(unlock.revenueCents)}</span>
        </div>
      )) : <p className="text-sm text-muted-foreground py-6 text-center">No vault unlocks yet.</p>}
    </section>
  </div>;
}
