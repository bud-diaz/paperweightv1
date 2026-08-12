import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, Disc3, FileAudio, Link2, LockKeyhole, Plus, ShieldCheck, Trash2 } from 'lucide-react';

import { EmptyState, Field, Modal, ViewHeader } from '@/components/primitives';
import * as api from '@/lib/api';
import { swatchFor, type LibraryStructure } from '@/lib/library';
import type { ModalKey } from '@/types';

type VaultTrackPrice = { content_id: number; title: string; filename: string; suggested_price: number; minimum_price: number; allow_free: 0 | 1; payment_type: string; recurring_interval: string | null };
type VaultProjectItem = { content_id: number; title: string; filename: string };
type VaultProject = { id: number; name: string; description: string | null; suggested_price: number; minimum_price: number; allow_free: 0 | 1; payment_type: string; recurring_interval: string | null; items: VaultProjectItem[] };
type VaultPricing = { trackPrices: VaultTrackPrice[]; projects: VaultProject[] };

function formatPriceCents(cents: number, allowFree: boolean) {
  if (allowFree && cents === 0) return 'Free / pay-what-you-want';
  return `$${(cents / 100).toFixed(2)}`;
}

function dollarsToCents(value: string) {
  return Math.max(0, Math.round((parseFloat(value) || 0) * 100));
}

function PricingFields({ suggestedPrice, setSuggestedPrice, minimumPrice, setMinimumPrice, allowFree, setAllowFree, paymentType, setPaymentType, recurringInterval, setRecurringInterval }: {
  suggestedPrice: string; setSuggestedPrice: (v: string) => void;
  minimumPrice: string; setMinimumPrice: (v: string) => void;
  allowFree: boolean; setAllowFree: (v: boolean) => void;
  paymentType: string; setPaymentType: (v: string) => void;
  recurringInterval: string; setRecurringInterval: (v: string) => void;
}) {
  return <div className="space-y-4">
    <div className="grid sm:grid-cols-2 gap-4">
      <Field label="Suggested price ($)" value={suggestedPrice} onChange={setSuggestedPrice} placeholder="5.00" />
      <Field label="Minimum price ($)" value={minimumPrice} onChange={setMinimumPrice} placeholder="1.00" />
    </div>
    <label className="flex gap-3 items-center text-sm"><input type="checkbox" checked={allowFree} onChange={(event) => setAllowFree(event.target.checked)} data-testid="checkbox-allow-free" className="accent-primary" /> Allow free / pay-what-you-want</label>
    <div className="grid sm:grid-cols-2 gap-4">
      <label className="text-sm text-muted-foreground">Payment type<select value={paymentType} onChange={(event) => setPaymentType(event.target.value)} data-testid="select-payment-type" className="input-studio w-full rounded-xl px-3.5 py-3 mt-2"><option value="one_time">One-time</option><option value="recurring">Recurring</option></select></label>
      {paymentType === 'recurring' && <label className="text-sm text-muted-foreground">Interval<select value={recurringInterval} onChange={(event) => setRecurringInterval(event.target.value)} data-testid="select-recurring-interval" className="input-studio w-full rounded-xl px-3.5 py-3 mt-2"><option value="monthly">Monthly</option><option value="annually">Annually</option></select></label>}
    </div>
  </div>;
}

function TrackPriceModal({ track, onClose, onNotify }: { track: VaultTrackPrice; onClose: () => void; onNotify: (message: string) => void }) {
  const queryClient = useQueryClient();
  const [suggestedPrice, setSuggestedPrice] = useState(String(track.suggested_price / 100));
  const [minimumPrice, setMinimumPrice] = useState(String(track.minimum_price / 100));
  const [allowFree, setAllowFree] = useState(!!track.allow_free);
  const [paymentType, setPaymentType] = useState(track.payment_type || 'one_time');
  const [recurringInterval, setRecurringInterval] = useState(track.recurring_interval || 'monthly');

  const save = useMutation({
    mutationFn: () => api.dashboard.vault.pricingTrack(track.content_id, {
      suggested_price: dollarsToCents(suggestedPrice),
      minimum_price: dollarsToCents(minimumPrice),
      allow_free: allowFree,
      payment_type: paymentType,
      recurring_interval: paymentType === 'recurring' ? recurringInterval : null,
    }),
    onSuccess: ({ res, data }: { res: Response; data: { error?: string } }) => {
      if (!res.ok) { onNotify(data.error || 'Failed to update pricing.'); return; }
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'vault', 'pricing'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'media'] });
      onNotify('Pricing updated.');
      onClose();
    },
    onError: () => onNotify('Failed to update pricing — connection error.'),
  });

  return <Modal title={`Price “${track.title || track.filename}”`} eyebrow="Vault / Track pricing" onClose={onClose}>
    <PricingFields suggestedPrice={suggestedPrice} setSuggestedPrice={setSuggestedPrice} minimumPrice={minimumPrice} setMinimumPrice={setMinimumPrice} allowFree={allowFree} setAllowFree={setAllowFree} paymentType={paymentType} setPaymentType={setPaymentType} recurringInterval={recurringInterval} setRecurringInterval={setRecurringInterval} />
    <div className="flex justify-end gap-2 mt-7">
      <button type="button" data-testid="button-cancel-track-price" onClick={onClose} className="ghost-button rounded-lg px-3 py-2 text-xs">Cancel</button>
      <button type="button" data-testid="button-save-track-price" onClick={() => save.mutate()} disabled={save.isPending} className="lime-button rounded-lg px-4 py-2 text-xs font-semibold disabled:opacity-50">{save.isPending ? 'Saving…' : 'Save pricing'}</button>
    </div>
  </Modal>;
}

function ProjectPriceModal({ project, availableTracks, onClose, onNotify }: { project: VaultProject; availableTracks: { id: number; title: string }[]; onClose: () => void; onNotify: (message: string) => void }) {
  const queryClient = useQueryClient();
  const [suggestedPrice, setSuggestedPrice] = useState(String(project.suggested_price / 100));
  const [minimumPrice, setMinimumPrice] = useState(String(project.minimum_price / 100));
  const [allowFree, setAllowFree] = useState(!!project.allow_free);
  const [paymentType, setPaymentType] = useState(project.payment_type || 'one_time');
  const [recurringInterval, setRecurringInterval] = useState(project.recurring_interval || 'monthly');
  const [addTrackId, setAddTrackId] = useState('');

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['dashboard', 'vault', 'pricing'] });
    queryClient.invalidateQueries({ queryKey: ['library', 'structure'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard', 'media'] });
  };

  const save = useMutation({
    mutationFn: () => api.dashboard.vault.updateCollection(project.id, {
      name: project.name,
      description: project.description,
      suggested_price: dollarsToCents(suggestedPrice),
      minimum_price: dollarsToCents(minimumPrice),
      allow_free: allowFree,
      payment_type: paymentType,
      recurring_interval: paymentType === 'recurring' ? recurringInterval : null,
    }),
    onSuccess: ({ res, data }: { res: Response; data: { error?: string } }) => {
      if (!res.ok) { onNotify(data.error || 'Failed to update pricing.'); return; }
      invalidate();
      onNotify('Pricing updated.');
      onClose();
    },
    onError: () => onNotify('Failed to update pricing — connection error.'),
  });

  const addTrack = useMutation({
    mutationFn: (contentId: number) => api.dashboard.vault.addCollectionTrack(project.id, { content_id: contentId }),
    onSuccess: ({ res, data }: { res: Response; data: { error?: string } }) => {
      if (!res.ok) { onNotify(data.error || 'Failed to add track.'); return; }
      invalidate();
      onNotify('Track added to collection.');
      setAddTrackId('');
    },
    onError: () => onNotify('Failed to add track — connection error.'),
  });

  const removeTrack = useMutation({
    mutationFn: (contentId: number) => api.dashboard.vault.removeCollectionTrack(project.id, contentId),
    onSuccess: ({ res, data }: { res: Response; data: { error?: string } }) => {
      if (!res.ok) { onNotify(data.error || 'Failed to remove track.'); return; }
      invalidate();
      onNotify('Track removed from collection.');
    },
    onError: () => onNotify('Failed to remove track — connection error.'),
  });

  return <Modal title={`Manage “${project.name}”`} eyebrow="Vault / Collection pricing" onClose={onClose} width="max-w-xl">
    <PricingFields suggestedPrice={suggestedPrice} setSuggestedPrice={setSuggestedPrice} minimumPrice={minimumPrice} setMinimumPrice={setMinimumPrice} allowFree={allowFree} setAllowFree={setAllowFree} paymentType={paymentType} setPaymentType={setPaymentType} recurringInterval={recurringInterval} setRecurringInterval={setRecurringInterval} />
    <div className="mt-6 pt-5 border-t border-white/[.08]">
      <p className="font-mono-ui text-[10px] uppercase tracking-[.2em] text-muted-foreground mb-3">Tracks in this collection</p>
      {project.items.length ? project.items.map((item) => (
        <div key={item.content_id} data-testid={`row-project-item-${item.content_id}`} className="flex items-center gap-3 py-2.5 border-b border-white/[.07] last:border-0">
          <span className="flex-1 text-sm truncate">{item.title || item.filename}</span>
          <button type="button" aria-label={`Remove ${item.title || item.filename}`} data-testid={`button-remove-project-item-${item.content_id}`} onClick={() => removeTrack.mutate(item.content_id)} disabled={removeTrack.isPending} className="text-muted-foreground hover:text-destructive"><Trash2 size={14} /></button>
        </div>
      )) : <p className="text-sm text-muted-foreground py-2">No tracks yet — add one below.</p>}
      {availableTracks.length > 0 && <div className="flex items-center gap-2 mt-4">
        <select value={addTrackId} onChange={(event) => setAddTrackId(event.target.value)} data-testid="select-add-project-track" className="input-studio flex-1 rounded-xl px-3.5 py-3 text-sm">
          <option value="">Add a track from your library…</option>
          {availableTracks.map((track) => <option key={track.id} value={track.id}>{track.title}</option>)}
        </select>
        <button type="button" data-testid="button-add-project-track" onClick={() => addTrack.mutate(parseInt(addTrackId, 10))} disabled={!addTrackId || addTrack.isPending} className="ghost-button rounded-lg px-3 py-3 text-xs disabled:opacity-50">Add</button>
      </div>}
    </div>
    <div className="flex justify-end gap-2 mt-7">
      <button type="button" data-testid="button-cancel-project-price" onClick={onClose} className="ghost-button rounded-lg px-3 py-2 text-xs">Close</button>
      <button type="button" data-testid="button-save-project-price" onClick={() => save.mutate()} disabled={save.isPending} className="lime-button rounded-lg px-4 py-2 text-xs font-semibold disabled:opacity-50">{save.isPending ? 'Saving…' : 'Save pricing'}</button>
    </div>
  </Modal>;
}

type DashboardMediaItem = { id: number; title: string | null; filename: string; visibility: string };

export function Vault({ onOpen, onNotify }: { onOpen: (modal: ModalKey) => void; onNotify: (message: string) => void }) {
  const { data, isLoading } = useQuery<VaultPricing>({ queryKey: ['dashboard', 'vault', 'pricing'], queryFn: () => api.dashboard.vault.pricing() });
  const { data: structure } = useQuery<LibraryStructure>({ queryKey: ['library', 'structure'], queryFn: () => api.library.structure() });
  const { data: mediaList } = useQuery<DashboardMediaItem[]>({ queryKey: ['dashboard', 'media'], queryFn: () => api.dashboard.media.list() });
  const [editingTrackId, setEditingTrackId] = useState<number | null>(null);
  const [editingProjectId, setEditingProjectId] = useState<number | null>(null);

  const trackPrices = data?.trackPrices || [];
  const projects = data?.projects || [];
  const availableTracks = (structure?.standalone || []).map((track) => ({ id: track.id, title: track.title }));
  const pricedTrackIds = new Set(trackPrices.map((track) => track.content_id));
  const projectTrackIds = new Set(projects.flatMap((project) => project.items.map((item) => item.content_id)));
  const unpricedVaultTracks: VaultTrackPrice[] = (mediaList || [])
    .filter((item) => item.visibility === 'vault' && !pricedTrackIds.has(item.id) && !projectTrackIds.has(item.id))
    .map((item) => ({ content_id: item.id, title: item.title || '', filename: item.filename, suggested_price: 0, minimum_price: 0, allow_free: 1, payment_type: 'one_time', recurring_interval: null }));
  const allPriceableTracks = [...trackPrices, ...unpricedVaultTracks];
  const hasAnything = trackPrices.length > 0 || projects.length > 0 || unpricedVaultTracks.length > 0;
  const editingTrack = allPriceableTracks.find((track) => track.content_id === editingTrackId) || null;
  const editingProject = projects.find((project) => project.id === editingProjectId) || null;

  return <div className="animate-enter"><ViewHeader eyebrow="Studio / Vault" title="Keep some things close." description="Private works, subscriber previews, and the pieces that deserve a quieter room." action={<button type="button" data-testid="button-vault-access" onClick={() => onOpen('vault')} className="ghost-button rounded-xl px-4 py-2.5 text-sm flex items-center gap-2"><LockKeyhole size={15} /> Access control</button>} />
    <div className="panel rounded-2xl p-5 sm:p-6 mb-6">
      <div className="flex flex-col sm:flex-row sm:items-center gap-5">
        <div className="h-14 w-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center"><LockKeyhole size={24} /></div>
        <div className="flex-1">
          <p className="font-mono-ui text-[10px] uppercase tracking-[.2em] text-primary">Private vault</p>
          <h2 className="font-display text-2xl font-semibold mt-1">{isLoading ? 'Loading…' : `${trackPrices.length} priced ${trackPrices.length === 1 ? 'track' : 'tracks'}, ${projects.length} ${projects.length === 1 ? 'collection' : 'collections'}`}</h2>
          <p className="text-sm text-muted-foreground mt-1">Tracks and collections with vault pricing set.</p>
        </div>
        <button type="button" data-testid="button-new-vault-item" onClick={() => onOpen('upload')} className="lime-button rounded-xl px-4 py-2.5 text-sm font-semibold flex items-center gap-2"><Plus size={15} /> Add to vault</button>
      </div>
    </div>
    {isLoading ? null : hasAnything ? <>
      {projects.length > 0 && <div className="mb-6">
        <p className="font-mono-ui text-[10px] uppercase tracking-[.2em] text-muted-foreground mb-3">Collections</p>
        <div className="grid md:grid-cols-2 gap-3">
          {projects.map((project) => (
            <button type="button" key={project.id} data-testid={`button-manage-collection-${project.id}`} onClick={() => setEditingProjectId(project.id)} className="panel rounded-2xl p-4 flex gap-3 items-center text-left hover:bg-white/[.04]">
              <div className="h-12 w-12 rounded-xl flex items-center justify-center" style={{ background: `linear-gradient(135deg, ${swatchFor(project.id)}, #272a46)` }}><Disc3 size={17} className="text-[#161827]" /></div>
              <div className="flex-1 min-w-0"><p className="font-medium text-sm truncate">{project.name}</p><p className="text-xs text-muted-foreground mt-1">{project.items.length} {project.items.length === 1 ? 'track' : 'tracks'} · {formatPriceCents(project.suggested_price, !!project.allow_free)}</p></div>
              <ArrowUpRight size={14} className="text-muted-foreground" />
            </button>
          ))}
        </div>
      </div>}
      {trackPrices.length > 0 && <div className="mb-6">
        <p className="font-mono-ui text-[10px] uppercase tracking-[.2em] text-muted-foreground mb-3">Priced tracks</p>
        <div className="grid md:grid-cols-2 gap-3">
          {trackPrices.map((track) => (
            <div className="panel rounded-2xl p-4 flex gap-3 items-center" key={track.content_id}>
              <div className="h-12 w-12 rounded-xl flex items-center justify-center" style={{ background: `linear-gradient(135deg, ${swatchFor(track.content_id)}, #272a46)` }}><FileAudio size={17} className="text-[#161827]" /></div>
              <div className="flex-1 min-w-0"><p className="font-medium text-sm truncate">{track.title || track.filename}</p><p className="text-xs text-muted-foreground mt-1">{formatPriceCents(track.suggested_price, !!track.allow_free)}</p></div>
              <button type="button" data-testid={`button-edit-track-price-${track.content_id}`} onClick={() => setEditingTrackId(track.content_id)} className="ghost-button h-8 px-2.5 rounded-lg text-xs flex items-center gap-1.5"><Link2 size={13} /> Edit price</button>
            </div>
          ))}
        </div>
      </div>}
      {unpricedVaultTracks.length > 0 && <div>
        <p className="font-mono-ui text-[10px] uppercase tracking-[.2em] text-muted-foreground mb-3">Needs a price</p>
        <div className="grid md:grid-cols-2 gap-3">
          {unpricedVaultTracks.map((track) => (
            <div className="panel rounded-2xl p-4 flex gap-3 items-center" key={track.content_id}>
              <div className="h-12 w-12 rounded-xl flex items-center justify-center" style={{ background: `linear-gradient(135deg, ${swatchFor(track.content_id)}, #272a46)` }}><FileAudio size={17} className="text-[#161827]" /></div>
              <div className="flex-1 min-w-0"><p className="font-medium text-sm truncate">{track.title || track.filename}</p><p className="text-xs text-muted-foreground mt-1">Marked vault, no price set</p></div>
              <button type="button" data-testid={`button-set-track-price-${track.content_id}`} onClick={() => setEditingTrackId(track.content_id)} className="lime-button h-8 px-2.5 rounded-lg text-xs font-semibold">Set price</button>
            </div>
          ))}
        </div>
      </div>}
    </> : (
      <EmptyState icon={LockKeyhole} title="Nothing priced yet" body="Set a price on a track or collection to add it to the vault." action="Open library" onClick={() => onOpen('library')} />
    )}
    <div className="panel rounded-2xl p-5 sm:p-6 mt-6"><div className="flex items-start gap-3"><ShieldCheck size={18} className="text-primary mt-0.5" /><div><h2 className="font-display text-lg font-semibold">A little privacy, by design.</h2><p className="text-xs text-muted-foreground mt-2 max-w-xl leading-relaxed">Vault links are encrypted and expire when you choose. Anyone with a link can listen, but downloads stay off unless you explicitly turn them on.</p><button type="button" data-testid="button-learn-vault" onClick={() => onOpen('vault')} className="text-xs text-primary mt-4">Manage vault policy <ArrowUpRight size={13} className="inline ml-1" /></button></div></div></div>
    {editingTrack && <TrackPriceModal track={editingTrack} onClose={() => setEditingTrackId(null)} onNotify={onNotify} />}
    {editingProject && <ProjectPriceModal project={editingProject} availableTracks={availableTracks} onClose={() => setEditingProjectId(null)} onNotify={onNotify} />}
  </div>;
}
