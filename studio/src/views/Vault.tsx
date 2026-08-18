import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ArrowUpRight, Copy, Disc3, FileAudio, ImagePlus, Link2, LockKeyhole, Plus, ShieldCheck, Star, Trash2 } from 'lucide-react';

import { EmptyState, Field, Modal, ViewHeader } from '@/components/primitives';
import * as api from '@/lib/api';
import { swatchFor, type LibraryStructure } from '@/lib/library';
import type { ModalKey } from '@/types';

type VaultTrackPrice = { content_id: number; title: string; filename: string; suggested_price: number; minimum_price: number; allow_free: 0 | 1; payment_type: string; recurring_interval: string | null };
type VaultProjectItem = { content_id: number; title: string; filename: string };
type VaultProject = { id: number; name: string; description: string | null; suggested_price: number; minimum_price: number; allow_free: 0 | 1; payment_type: string; recurring_interval: string | null; items: VaultProjectItem[] };
type VaultPricing = { trackPrices: VaultTrackPrice[]; projects: VaultProject[] };
type VaultToken = { id: number; label: string | null; tier: string; is_active: boolean; last_used?: string | null; scope_type?: string | null; scope_id?: number | null };
type TokenAssignment = { id: number; email: string; created_at?: string | null };
type Highlight = { highlight_type: string | null; highlight_id: number | null };

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

function ProjectPriceModal({ project, availableTracks, onClose, onNotify, onManageTracks }: { project: VaultProject; availableTracks: { id: number; title: string }[]; onClose: () => void; onNotify: (message: string) => void; onManageTracks?: (projectId: number) => void }) {
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
  const deleteProject = useMutation({
    mutationFn: () => api.dashboard.vault.deleteCollection(project.id),
    onSuccess: ({ res, data }: { res: Response; data: { error?: string } }) => {
      if (!res.ok) { onNotify(data.error || 'Failed to delete collection.'); return; }
      invalidate();
      onNotify('Collection deleted.');
      onClose();
    },
    onError: () => onNotify('Failed to delete collection — connection error.'),
  });
  const reorderTrack = useMutation({
    mutationFn: (contentIds: number[]) => api.dashboard.vault.reorderCollectionTracks(project.id, { content_ids: contentIds }),
    onSuccess: ({ res, data }: { res: Response; data: { error?: string } }) => {
      if (!res.ok) { onNotify(data.error || 'Failed to reorder collection.'); return; }
      invalidate();
      onNotify('Collection order updated.');
    },
    onError: () => onNotify('Failed to reorder collection — connection error.'),
  });
  const moveTrack = (contentId: number, direction: -1 | 1) => {
    const ids = project.items.map((item) => item.content_id);
    const index = ids.indexOf(contentId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= ids.length) return;
    const next = [...ids];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    reorderTrack.mutate(next);
  };

  return <Modal title={`Manage “${project.name}”`} eyebrow="Vault / Collection pricing" onClose={onClose} width="max-w-xl">
    <PricingFields suggestedPrice={suggestedPrice} setSuggestedPrice={setSuggestedPrice} minimumPrice={minimumPrice} setMinimumPrice={setMinimumPrice} allowFree={allowFree} setAllowFree={setAllowFree} paymentType={paymentType} setPaymentType={setPaymentType} recurringInterval={recurringInterval} setRecurringInterval={setRecurringInterval} />
    <div className="mt-6 pt-5 border-t border-white/[.08]">
      <div className="flex items-center justify-between mb-3">
        <p className="font-mono-ui text-[10px] uppercase tracking-[.2em] text-muted-foreground">Tracks in this collection</p>
        {onManageTracks && <button type="button" data-testid="button-manage-tracks" onClick={() => onManageTracks(project.id)} className="text-xs text-primary flex items-center gap-1">Manage in Releases <ArrowUpRight size={12} /></button>}
      </div>
      {project.items.length ? project.items.map((item) => (
        <div key={item.content_id} data-testid={`row-project-item-${item.content_id}`} className="flex items-center gap-3 py-2.5 border-b border-white/[.07] last:border-0">
          <span className="flex-1 text-sm truncate">{item.title || item.filename}</span>
          <button type="button" aria-label={`Move ${item.title || item.filename} up`} data-testid={`button-move-project-item-up-${item.content_id}`} onClick={() => moveTrack(item.content_id, -1)} disabled={reorderTrack.isPending} className="text-muted-foreground hover:text-primary"><ArrowUp size={14} /></button>
          <button type="button" aria-label={`Move ${item.title || item.filename} down`} data-testid={`button-move-project-item-down-${item.content_id}`} onClick={() => moveTrack(item.content_id, 1)} disabled={reorderTrack.isPending} className="text-muted-foreground hover:text-primary"><ArrowDown size={14} /></button>
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
      <button type="button" data-testid="button-delete-project" onClick={() => { if (window.confirm(`Delete "${project.name}"?`)) deleteProject.mutate(); }} disabled={deleteProject.isPending} className="mr-auto ghost-button rounded-lg px-3 py-2 text-xs text-destructive disabled:opacity-50">Delete collection</button>
      <button type="button" data-testid="button-cancel-project-price" onClick={onClose} className="ghost-button rounded-lg px-3 py-2 text-xs">Close</button>
      <button type="button" data-testid="button-save-project-price" onClick={() => save.mutate()} disabled={save.isPending} className="lime-button rounded-lg px-4 py-2 text-xs font-semibold disabled:opacity-50">{save.isPending ? 'Saving…' : 'Save pricing'}</button>
    </div>
  </Modal>;
}

type DashboardMediaItem = { id: number; title: string | null; filename: string; visibility: string };

function TokenManager({ accounts, onNotify }: { accounts: { id?: number; email: string }[]; onNotify: (message: string) => void }) {
  const queryClient = useQueryClient();
  const { data: tokens = [] } = useQuery<VaultToken[]>({ queryKey: ['dashboard', 'tokens'], queryFn: () => api.dashboard.tokens.list() });
  const [label, setLabel] = useState('');
  const [tier, setTier] = useState('subscriber');
  const [email, setEmail] = useState('');
  const [createdToken, setCreatedToken] = useState('');
  const [openTokenId, setOpenTokenId] = useState<number | null>(null);
  const { data: assignments = [] } = useQuery<TokenAssignment[]>({ queryKey: ['dashboard', 'tokens', openTokenId, 'assignments'], queryFn: () => api.dashboard.tokens.assignments(openTokenId), enabled: openTokenId != null });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['dashboard', 'tokens'] });
  const create = useMutation({
    mutationFn: () => api.dashboard.tokens.create({ label: label.trim(), tier }),
    onSuccess: async ({ res, data }: { res: Response; data: { error?: string; token?: string; id?: number } }) => {
      if (!res.ok) { onNotify(data.error || 'Failed to create token.'); return; }
      setCreatedToken(data.token || '');
      if (email.trim() && data.id) await api.dashboard.tokens.assign(data.id, { email: email.trim() });
      setLabel('');
      setEmail('');
      invalidate();
      onNotify('Token created.');
    },
    onError: () => onNotify('Failed to create token.'),
  });
  const revoke = useMutation({ mutationFn: (id: number) => api.dashboard.tokens.revoke(id), onSuccess: () => { invalidate(); onNotify('Token revoked.'); } });
  const updateTier = useMutation({ mutationFn: ({ id, nextTier }: { id: number; nextTier: string }) => api.dashboard.tokens.setTier(id, { tier: nextTier }), onSuccess: () => { invalidate(); onNotify('Token tier updated.'); } });
  const assign = useMutation({ mutationFn: ({ id, nextEmail }: { id: number; nextEmail: string }) => api.dashboard.tokens.assign(id, { email: nextEmail }), onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['dashboard', 'tokens', openTokenId, 'assignments'] }); onNotify('Account assigned.'); } });
  const unassign = useMutation({ mutationFn: ({ tokenId, assignmentId }: { tokenId: number; assignmentId: number }) => api.dashboard.tokens.unassign(tokenId, assignmentId), onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['dashboard', 'tokens', openTokenId, 'assignments'] }); onNotify('Assignment removed.'); } });

  return <section className="panel rounded-2xl p-5 sm:p-6 mt-6">
    <div className="flex items-center gap-3 mb-5"><LockKeyhole size={18} className="text-primary" /><h2 className="font-display text-xl font-semibold">Access tokens</h2></div>
    <div className="grid lg:grid-cols-[1fr_160px_1fr_auto] gap-3 items-end">
      <Field label="Token label" value={label} onChange={setLabel} placeholder="July subscriber comp" />
      <label className="text-sm text-muted-foreground">Tier<select value={tier} onChange={(event) => setTier(event.target.value)} className="input-studio w-full rounded-xl px-3.5 py-3 mt-2"><option value="subscriber">Subscriber</option><option value="pro">Pro</option><option value="all_access">All-access</option></select></label>
      <label className="text-sm text-muted-foreground">Assign to account<input list="vault-token-accounts" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="listener@example.com" className="input-studio w-full rounded-xl px-3.5 py-3 mt-2" /></label>
      <button type="button" data-testid="button-create-vault-token" onClick={() => create.mutate()} disabled={!label.trim() || create.isPending} className="lime-button rounded-xl px-4 py-3 text-xs font-semibold disabled:opacity-50">Create</button>
    </div>
    <datalist id="vault-token-accounts">{accounts.map((account) => <option key={account.email} value={account.email} />)}</datalist>
    {createdToken && <div className="panel-subtle rounded-xl p-4 mt-4"><p className="text-xs text-primary">Share once — this token will not be shown again.</p><button type="button" onClick={() => { navigator.clipboard?.writeText(createdToken); onNotify('Token copied.'); }} className="text-xs break-all text-left mt-2 flex gap-2"><Copy size={13} className="shrink-0 text-primary" />{createdToken}</button></div>}
    <div className="space-y-3 mt-5">{tokens.length ? tokens.map((token) => <div key={token.id} className="panel-subtle rounded-xl p-4">
      <div className="flex flex-col lg:flex-row lg:items-center gap-3"><div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{token.label || 'Untitled token'}</p><p className="text-xs text-muted-foreground mt-1">{token.last_used ? `used ${token.last_used.slice(0, 10)}` : 'unused'} · {token.is_active ? 'active' : 'revoked'}{token.scope_type ? ` · ${token.scope_type} #${token.scope_id}` : ''}</p></div>{token.is_active && <select value={token.tier} onChange={(event) => updateTier.mutate({ id: token.id, nextTier: event.target.value })} className="input-studio rounded-lg px-2 py-2 text-xs"><option value="subscriber">Subscriber</option><option value="pro">Pro</option><option value="all_access">All-access</option></select>}<button type="button" onClick={() => setOpenTokenId(openTokenId === token.id ? null : token.id)} className="ghost-button rounded-lg px-3 py-2 text-xs">Assignments</button><button type="button" onClick={() => revoke.mutate(token.id)} disabled={!token.is_active || revoke.isPending} className="ghost-button rounded-lg px-3 py-2 text-xs text-destructive disabled:opacity-50">Revoke</button></div>
      {openTokenId === token.id && <div className="pt-4 mt-4 border-t border-white/[.08]"><div className="flex gap-2"><input placeholder="listener@example.com" onKeyDown={(event) => { if (event.key === 'Enter' && event.currentTarget.value.trim()) { assign.mutate({ id: token.id, nextEmail: event.currentTarget.value.trim() }); event.currentTarget.value = ''; } }} className="input-studio flex-1 rounded-lg px-3 py-2 text-sm" /><button type="button" onClick={(event) => { const input = event.currentTarget.previousElementSibling as HTMLInputElement | null; if (input?.value.trim()) { assign.mutate({ id: token.id, nextEmail: input.value.trim() }); input.value = ''; } }} className="ghost-button rounded-lg px-3 py-2 text-xs">Assign</button></div><div className="space-y-2 mt-3">{assignments.length ? assignments.map((assignment) => <div key={assignment.id} className="flex items-center gap-2 text-xs"><span className="flex-1">{assignment.email}</span><button type="button" onClick={() => unassign.mutate({ tokenId: token.id, assignmentId: assignment.id })} className="text-destructive">Remove</button></div>) : <p className="text-xs text-muted-foreground">No account assignments yet.</p>}</div></div>}
    </div>) : <p className="text-xs text-muted-foreground">No access tokens yet.</p>}</div>
  </section>;
}

function TrackArtworkButton({ trackId, onNotify }: { trackId: number; onNotify: (message: string) => void }) {
  const queryClient = useQueryClient();
  const upload = useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append('artwork', file);
      return api.dashboard.media.uploadArtwork(trackId, formData);
    },
    onSuccess: ({ res, data }: { res: Response; data: { error?: string } }) => {
      if (!res.ok) { onNotify(data.error || 'Artwork upload failed.'); return; }
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'media'] });
      onNotify('Artwork uploaded.');
    },
    onError: () => onNotify('Artwork upload failed.'),
  });
  return <label className="ghost-button h-8 px-2.5 rounded-lg text-xs flex items-center gap-1.5 cursor-pointer"><ImagePlus size={13} /> Art<input type="file" accept="image/*" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) upload.mutate(file); event.target.value = ''; }} /></label>;
}

export function Vault({ onOpen, onNotify, focusProjectId, onConsumeFocus, onManageTracks }: { onOpen: (modal: ModalKey) => void; onNotify: (message: string) => void; focusProjectId?: number | null; onConsumeFocus?: () => void; onManageTracks?: (projectId: number) => void }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery<VaultPricing>({ queryKey: ['dashboard', 'vault', 'pricing'], queryFn: () => api.dashboard.vault.pricing() });
  const { data: highlight } = useQuery<Highlight>({ queryKey: ['dashboard', 'vault', 'highlight'], queryFn: () => api.dashboard.vault.getHighlight() });
  const { data: accounts = [] } = useQuery<{ email: string }[]>({ queryKey: ['dashboard', 'accounts'], queryFn: () => api.dashboard.accounts() });
  const { data: structure } = useQuery<LibraryStructure>({ queryKey: ['library', 'structure'], queryFn: () => api.library.structure() });
  const { data: mediaList } = useQuery<DashboardMediaItem[]>({ queryKey: ['dashboard', 'media'], queryFn: () => api.dashboard.media.list() });
  const [editingTrackId, setEditingTrackId] = useState<number | null>(null);
  const [editingProjectId, setEditingProjectId] = useState<number | null>(null);

  useEffect(() => {
    if (focusProjectId == null) return;
    if (!(data?.projects || []).some((project) => project.id === focusProjectId)) return;
    setEditingProjectId(focusProjectId);
    onConsumeFocus?.();
  }, [focusProjectId, data, onConsumeFocus]);

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
  const setHighlight = useMutation({
    mutationFn: (body: { type: 'track' | 'project' | null; id: number | null }) => api.dashboard.vault.setHighlight(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'vault', 'highlight'] });
      onNotify('Vault highlight updated.');
    },
    onError: () => onNotify('Failed to update vault highlight.'),
  });
  const toggleHighlight = (type: 'track' | 'project', id: number) => {
    const active = highlight?.highlight_type === type && highlight?.highlight_id === id;
    setHighlight.mutate(active ? { type: null, id: null } : { type, id });
  };

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
              <Star size={14} className={highlight?.highlight_type === 'project' && highlight.highlight_id === project.id ? 'text-primary' : 'text-muted-foreground'} onClick={(event) => { event.stopPropagation(); toggleHighlight('project', project.id); }} />
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
              <TrackArtworkButton trackId={track.content_id} onNotify={onNotify} />
              <button type="button" data-testid={`button-highlight-track-${track.content_id}`} onClick={() => toggleHighlight('track', track.content_id)} className="ghost-button h-8 px-2.5 rounded-lg text-xs flex items-center gap-1.5"><Star size={13} className={highlight?.highlight_type === 'track' && highlight.highlight_id === track.content_id ? 'text-primary' : ''} /> Highlight</button>
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
    <TokenManager accounts={accounts} onNotify={onNotify} />
    <div className="panel rounded-2xl p-5 sm:p-6 mt-6"><div className="flex items-start gap-3"><ShieldCheck size={18} className="text-primary mt-0.5" /><div><h2 className="font-display text-lg font-semibold">A little privacy, by design.</h2><p className="text-xs text-muted-foreground mt-2 max-w-xl leading-relaxed">Vault links are encrypted and expire when you choose. Anyone with a link can listen, but downloads stay off unless you explicitly turn them on.</p><button type="button" data-testid="button-learn-vault" onClick={() => onOpen('vault')} className="text-xs text-primary mt-4">Manage vault policy <ArrowUpRight size={13} className="inline ml-1" /></button></div></div></div>
    {editingTrack && <TrackPriceModal track={editingTrack} onClose={() => setEditingTrackId(null)} onNotify={onNotify} />}
    {editingProject && <ProjectPriceModal project={editingProject} availableTracks={availableTracks} onClose={() => setEditingProjectId(null)} onNotify={onNotify} onManageTracks={onManageTracks} />}
  </div>;
}
