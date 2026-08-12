import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, FileAudio, Link2, LockKeyhole, Plus, ShieldCheck } from 'lucide-react';

import { EmptyState, ViewHeader } from '@/components/primitives';
import * as api from '@/lib/api';
import { swatchFor } from '@/lib/library';
import type { ModalKey } from '@/types';

type VaultTrackPrice = { content_id: number; title: string; filename: string; suggested_price: number; allow_free: 0 | 1 };
type VaultProjectItem = { content_id: number; title: string; filename: string };
type VaultProject = { id: number; name: string; items: VaultProjectItem[] };
type VaultPricing = { trackPrices: VaultTrackPrice[]; projects: VaultProject[] };

function formatPriceCents(cents: number, allowFree: boolean) {
  if (allowFree && cents === 0) return 'Free / pay-what-you-want';
  return `$${(cents / 100).toFixed(2)}`;
}

export function Vault({ onOpen, onNotify }: { onOpen: (modal: ModalKey) => void; onNotify: (message: string) => void }) {
  const { data, isLoading } = useQuery<VaultPricing>({ queryKey: ['dashboard', 'vault', 'pricing'], queryFn: () => api.dashboard.vault.pricing() });

  const standaloneItems = (data?.trackPrices || []).map((track) => ({ id: track.content_id, title: track.title || track.filename, subtitle: formatPriceCents(track.suggested_price, !!track.allow_free) }));
  const projectItems = (data?.projects || []).flatMap((project) => project.items.map((item) => ({ id: item.content_id, title: item.title || item.filename, subtitle: project.name })));
  const allItems = [...standaloneItems, ...projectItems];

  return <div className="animate-enter"><ViewHeader eyebrow="Studio / Vault" title="Keep some things close." description="Private works, subscriber previews, and the pieces that deserve a quieter room." action={<button type="button" data-testid="button-vault-access" onClick={() => onOpen('vault')} className="ghost-button rounded-xl px-4 py-2.5 text-sm flex items-center gap-2"><LockKeyhole size={15} /> Access control</button>} />
    <div className="panel rounded-2xl p-5 sm:p-6 mb-6">
      <div className="flex flex-col sm:flex-row sm:items-center gap-5">
        <div className="h-14 w-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center"><LockKeyhole size={24} /></div>
        <div className="flex-1">
          <p className="font-mono-ui text-[10px] uppercase tracking-[.2em] text-primary">Private vault</p>
          <h2 className="font-display text-2xl font-semibold mt-1">{isLoading ? 'Loading…' : `${allItems.length} priced ${allItems.length === 1 ? 'work' : 'works'}`}</h2>
          <p className="text-sm text-muted-foreground mt-1">Tracks and collections with vault pricing set.</p>
        </div>
        <button type="button" data-testid="button-new-vault-item" onClick={() => onOpen('upload')} className="lime-button rounded-xl px-4 py-2.5 text-sm font-semibold flex items-center gap-2"><Plus size={15} /> Add to vault</button>
      </div>
    </div>
    {isLoading ? null : allItems.length ? (
      <div className="grid md:grid-cols-2 gap-3">
        {allItems.map((item) => (
          <div className="panel rounded-2xl p-4 flex gap-3 items-center" key={item.id}>
            <div className="h-12 w-12 rounded-xl flex items-center justify-center" style={{ background: `linear-gradient(135deg, ${swatchFor(item.id)}, #272a46)` }}><FileAudio size={17} className="text-[#161827]" /></div>
            <div className="flex-1 min-w-0"><p className="font-medium text-sm truncate">{item.title}</p><p className="text-xs text-muted-foreground mt-1">{item.subtitle}</p></div>
            <button type="button" data-testid={`button-vault-share-${item.id}`} onClick={() => onNotify(`${item.title} access token copied.`)} className="ghost-button h-8 px-2.5 rounded-lg text-xs flex items-center gap-1.5"><Link2 size={13} /> Share</button>
          </div>
        ))}
      </div>
    ) : (
      <EmptyState icon={LockKeyhole} title="Nothing priced yet" body="Set a price on a track or collection to add it to the vault." action="Open library" onClick={() => onOpen('library')} />
    )}
    <div className="panel rounded-2xl p-5 sm:p-6 mt-6"><div className="flex items-start gap-3"><ShieldCheck size={18} className="text-primary mt-0.5" /><div><h2 className="font-display text-lg font-semibold">A little privacy, by design.</h2><p className="text-xs text-muted-foreground mt-2 max-w-xl leading-relaxed">Vault links are encrypted and expire when you choose. Anyone with a link can listen, but downloads stay off unless you explicitly turn them on.</p><button type="button" data-testid="button-learn-vault" onClick={() => onOpen('vault')} className="text-xs text-primary mt-4">Manage vault policy <ArrowUpRight size={13} className="inline ml-1" /></button></div></div></div>
  </div>;
}
