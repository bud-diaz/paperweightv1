import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Modal } from '@/components/primitives';
import * as api from '@/lib/api';
import { cn } from '@/lib/utils';

type TipConfig = { amounts: number[]; customEnabled: boolean };

function centsToDollarString(cents: number) {
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

function draftFrom(config: TipConfig | undefined) {
  const amounts = config?.amounts?.length === 3 ? config.amounts : [300, 500, 1000];
  return { amounts: amounts.map(centsToDollarString), customEnabled: config?.customEnabled ?? true };
}

export function TipConfigModal({ onClose, onNotify }: { onClose: () => void; onNotify: (message: string) => void }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery<TipConfig>({ queryKey: ['dashboard', 'tip-config'], queryFn: () => api.dashboard.tipConfig.get() });
  const [draft, setDraft] = useState(() => draftFrom(undefined));

  useEffect(() => { if (data) setDraft(draftFrom(data)); }, [data]);

  const save = useMutation({
    mutationFn: () => api.dashboard.tipConfig.update({
      amounts: draft.amounts.map((value) => Math.round(parseFloat(value) * 100)),
      customEnabled: draft.customEnabled,
    }),
    onSuccess: ({ res, data: result }: { res: Response; data: { error?: string } }) => {
      if (!res.ok) { onNotify(result.error || 'Failed to save tip presets.'); return; }
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'tip-config'] });
      onNotify('Tip presets saved.');
      onClose();
    },
    onError: () => onNotify('Failed to save tip presets — connection error.'),
  });

  const parsedAmounts = draft.amounts.map((value) => Math.round(parseFloat(value) * 100));
  const valid = parsedAmounts.every((cents) => Number.isFinite(cents) && cents >= 100);

  return (
    <Modal title="Set your tip presets." eyebrow="Monetize / Tips" onClose={onClose}>
      <p className="text-sm text-muted-foreground -mt-2 mb-5">These are the quick-pick amounts listeners see when they tip you. Each must be at least $1.</p>
      <div className="grid grid-cols-3 gap-2">
        {draft.amounts.map((value, i) => (
          <label key={i} className="text-xs text-muted-foreground">Preset {i + 1}
            <div className="relative mt-2">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
              <input
                type="number"
                min="1"
                step="0.01"
                value={value}
                data-testid={`input-tip-preset-${i}`}
                onChange={(event) => setDraft((prev) => ({ ...prev, amounts: prev.amounts.map((v, idx) => (idx === i ? event.target.value : v)) }))}
                className="input-studio w-full rounded-xl pl-7 pr-3 py-3 text-sm"
              />
            </div>
          </label>
        ))}
      </div>
      <div className="flex items-center gap-4 mt-6 pt-4 border-t border-white/[.08]">
        <div className="flex-1"><p className="text-sm">Allow custom amounts</p><p className="text-xs text-muted-foreground mt-1">Let listeners type in their own amount instead of a preset.</p></div>
        <button type="button" role="switch" aria-checked={draft.customEnabled} data-testid="toggle-tip-custom-enabled" onClick={() => setDraft((prev) => ({ ...prev, customEnabled: !prev.customEnabled }))} className={cn('h-7 w-12 rounded-full p-1 transition-colors shrink-0', draft.customEnabled ? 'bg-primary' : 'bg-white/15')}>
          <span className={cn('block h-5 w-5 rounded-full bg-[#171a28] transition-transform', draft.customEnabled && 'translate-x-5')} />
        </button>
      </div>
      {!valid && <p className="text-xs text-destructive mt-4">Each preset must be a valid amount of at least $1.00.</p>}
      <div className="flex justify-end mt-6">
        <button type="button" data-testid="button-save-tip-config" onClick={() => save.mutate()} disabled={save.isPending || isLoading || !valid} className="lime-button rounded-lg px-4 py-2 text-xs font-semibold disabled:opacity-50">{save.isPending ? 'Saving…' : 'Save presets'}</button>
      </div>
    </Modal>
  );
}
