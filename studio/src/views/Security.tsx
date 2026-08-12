import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, QrCode, ShieldCheck, Trash2 } from 'lucide-react';

import { ViewHeader } from '@/components/primitives';
import * as api from '@/lib/api';

type TwoFAStatus = { enabled: boolean };
type Device = { id: number; label: string; created_at: string | null; last_used_at: string | null; revoked_at: string | null };

function formatDate(iso: string | null) {
  if (!iso) return 'never';
  try {
    const normalized = iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`;
    return new Date(normalized).toLocaleString();
  } catch {
    return iso;
  }
}

function TwoFactorSection({ onNotify }: { onNotify: (message: string) => void }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery<TwoFAStatus>({ queryKey: ['dashboard', '2fa', 'status'], queryFn: () => api.dashboard.twoFA.status() });

  const [setupOpen, setSetupOpen] = useState(false);
  const [secret, setSecret] = useState('');
  const [confirmCode, setConfirmCode] = useState('');
  const [confirmError, setConfirmError] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [disableCode, setDisableCode] = useState('');
  const [disableError, setDisableError] = useState('');
  const [disableOpen, setDisableOpen] = useState(false);

  const refreshStatus = () => queryClient.invalidateQueries({ queryKey: ['dashboard', '2fa', 'status'] });

  const startSetup = useMutation({
    mutationFn: () => api.dashboard.twoFA.setup(),
    onSuccess: (result: { secret: string }) => {
      setSecret(result.secret);
      setConfirmCode('');
      setConfirmError('');
      setSetupOpen(true);
    },
    onError: () => onNotify('Failed to start 2FA setup.'),
  });

  const confirmSetup = useMutation({
    mutationFn: (code: string) => api.dashboard.twoFA.confirm(code),
    onSuccess: ({ res, data: result }: { res: Response; data: { error?: string; recoveryCodes?: string[] } }) => {
      if (!res.ok) { setConfirmError(result.error || 'Failed'); return; }
      setSetupOpen(false);
      setRecoveryCodes(result.recoveryCodes || []);
    },
    onError: () => setConfirmError('Connection error'),
  });

  const disable2fa = useMutation({
    mutationFn: (code: string) => api.dashboard.twoFA.disable(code),
    onSuccess: ({ res, data: result }: { res: Response; data: { error?: string } }) => {
      if (!res.ok) { setDisableError(result.error || 'Failed'); return; }
      setDisableCode('');
      setDisableOpen(false);
      refreshStatus();
      onNotify('Two-factor authentication disabled.');
    },
    onError: () => setDisableError('Connection error'),
  });

  const enabled = !!data?.enabled;

  return (
    <section className="panel rounded-2xl p-5 sm:p-6">
      <div className="flex items-start gap-4">
        <span className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center"><ShieldCheck size={19} /></span>
        <div className="flex-1">
          <h2 className="font-display text-xl font-semibold">Two-factor authentication</h2>
          <p className="text-sm text-muted-foreground mt-1">Add another lock before anyone reaches your studio.</p>
        </div>
        {!isLoading && !enabled && !setupOpen && (
          <button type="button" data-testid="button-2fa-enable" onClick={() => startSetup.mutate()} disabled={startSetup.isPending} className="lime-button rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-50">
            {startSetup.isPending ? 'Starting…' : 'Enable'}
          </button>
        )}
      </div>

      <div className="mt-5 pl-14 text-xs">
        {isLoading ? <span className="text-muted-foreground">Checking status…</span> : enabled
          ? <span className="text-primary">Enabled · Authenticator app</span>
          : <span className="text-muted-foreground">Not enabled</span>}
      </div>

      {setupOpen && (
        <div className="mt-5 pl-14 panel-subtle rounded-xl p-4 max-w-md">
          <p className="text-xs text-muted-foreground">Scan this secret with your authenticator app, then enter the code to activate.</p>
          <p data-testid="text-2fa-secret" className="font-mono-ui text-sm mt-3 break-all select-all">{secret}</p>
          <input
            data-testid="input-2fa-confirm-code"
            value={confirmCode}
            onChange={(event) => setConfirmCode(event.target.value)}
            placeholder="6-digit code"
            className="input-studio w-full rounded-lg px-3 py-2 text-sm mt-3"
          />
          {confirmError && <p className="text-xs text-destructive mt-2">{confirmError}</p>}
          <div className="flex gap-2 mt-3">
            <button type="button" data-testid="button-2fa-confirm" onClick={() => confirmSetup.mutate(confirmCode.trim())} disabled={confirmSetup.isPending || !confirmCode.trim()} className="lime-button rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-50">{confirmSetup.isPending ? 'Enabling…' : 'Enable 2FA'}</button>
            <button type="button" data-testid="button-2fa-cancel-setup" onClick={() => setSetupOpen(false)} className="ghost-button rounded-lg px-3 py-2 text-xs">Cancel</button>
          </div>
        </div>
      )}

      {recoveryCodes && (
        <div className="mt-5 pl-14 panel-subtle rounded-xl p-4 max-w-md">
          <p className="text-xs text-primary">2FA enabled. Save these recovery codes — each works once if you lose your authenticator.</p>
          <pre data-testid="text-2fa-recovery-codes" className="font-mono-ui text-xs mt-3 whitespace-pre-wrap select-all">{recoveryCodes.join('\n')}</pre>
          <button type="button" data-testid="button-2fa-codes-done" onClick={() => { setRecoveryCodes(null); refreshStatus(); }} className="lime-button rounded-lg px-3 py-2 text-xs font-semibold mt-3">Done</button>
        </div>
      )}

      {enabled && (
        <div className="mt-5 pl-14 max-w-md">
          {!disableOpen ? (
            <button type="button" data-testid="button-2fa-disable-open" onClick={() => setDisableOpen(true)} className="text-xs text-destructive">Disable 2FA</button>
          ) : (
            <div className="panel-subtle rounded-xl p-4">
              <p className="text-xs text-muted-foreground">Enter a current code (or a recovery code) to disable 2FA.</p>
              <input
                data-testid="input-2fa-disable-code"
                value={disableCode}
                onChange={(event) => setDisableCode(event.target.value)}
                placeholder="Code"
                className="input-studio w-full rounded-lg px-3 py-2 text-sm mt-3"
              />
              {disableError && <p className="text-xs text-destructive mt-2">{disableError}</p>}
              <div className="flex gap-2 mt-3">
                <button type="button" data-testid="button-2fa-disable-confirm" onClick={() => disable2fa.mutate(disableCode.trim())} disabled={disable2fa.isPending || !disableCode.trim()} className="rounded-lg px-3 py-2 text-xs font-semibold bg-destructive text-white disabled:opacity-50">{disable2fa.isPending ? 'Disabling…' : 'Disable 2FA'}</button>
                <button type="button" data-testid="button-2fa-disable-cancel" onClick={() => setDisableOpen(false)} className="ghost-button rounded-lg px-3 py-2 text-xs">Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function DeviceRow({ device, onNotify }: { device: Device; onNotify: (message: string) => void }) {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['dashboard', 'devices'] });

  const rename = useMutation({
    mutationFn: (label: string) => api.dashboard.devices.rename(device.id, label),
    onSuccess: () => { invalidate(); onNotify(`${device.label} renamed.`); },
  });
  const revoke = useMutation({
    mutationFn: () => api.dashboard.devices.revoke(device.id),
    onSuccess: () => { invalidate(); onNotify(`${device.label} revoked.`); },
  });

  const revoked = !!device.revoked_at;

  return (
    <div data-testid={`row-device-${device.id}`} className="flex items-center gap-4 py-4 border-b border-white/[.07] last:border-0">
      <div className="flex-1">
        <p className="text-sm">{device.label}</p>
        <p className="text-[11px] text-muted-foreground mt-1">paired {formatDate(device.created_at)} · last used {formatDate(device.last_used_at)}{revoked ? ' · revoked' : ''}</p>
      </div>
      {!revoked && (
        <div className="flex gap-2">
          <button
            type="button"
            data-testid={`button-rename-device-${device.id}`}
            onClick={() => {
              const label = window.prompt('Rename this device', device.label);
              if (label && label.trim()) rename.mutate(label.trim());
            }}
            className="ghost-button rounded-lg px-3 py-2 text-xs"
          >Rename</button>
          <button
            type="button"
            data-testid={`button-revoke-device-${device.id}`}
            onClick={() => {
              if (window.confirm(`Revoke "${device.label}"? It will be signed out of Studio immediately.`)) revoke.mutate();
            }}
            className="ghost-button rounded-lg px-2 py-2 text-xs text-destructive"
          ><Trash2 size={13} /></button>
        </div>
      )}
    </div>
  );
}

function DevicesSection({ onNotify }: { onNotify: (message: string) => void }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery<{ devices: Device[] }>({ queryKey: ['dashboard', 'devices'], queryFn: () => api.dashboard.devices.list() });

  const [pairing, setPairing] = useState<{ url: string; status: string } | null>(null);
  const svgRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const startPairing = async () => {
    if (pollRef.current) clearInterval(pollRef.current);
    setPairing({ url: '', status: 'Generating…' });
    try {
      const { pairToken, pairUrl } = await api.dashboard.devices.pair();
      setPairing({ url: pairUrl, status: 'Waiting for scan…' });
      if (window.qrcode && svgRef.current) {
        const qr = window.qrcode(0, 'M');
        qr.addData(pairUrl);
        qr.make();
        svgRef.current.innerHTML = qr.createSvgTag(5, 8);
      }
      pollRef.current = setInterval(async () => {
        try {
          const status = await api.dashboard.devices.pairStatus(pairToken);
          if (status.status === 'claimed') {
            if (pollRef.current) clearInterval(pollRef.current);
            setPairing(null);
            queryClient.invalidateQueries({ queryKey: ['dashboard', 'devices'] });
            onNotify('Device paired.');
          }
        } catch {
          if (pollRef.current) clearInterval(pollRef.current);
          setPairing({ url: '', status: 'Pairing code expired — generate a new one.' });
        }
      }, 2000);
    } catch {
      setPairing({ url: '', status: 'Failed to generate a pairing code.' });
    }
  };

  const devices = data?.devices || [];

  return (
    <section className="panel rounded-2xl p-5 sm:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-medium text-sm">Authorized devices</h2>
          <p className="text-xs text-muted-foreground mt-1">Phones and other devices signed into Studio via QR pairing.</p>
        </div>
        <button type="button" data-testid="button-pair-device" onClick={startPairing} className="ghost-button rounded-lg px-3 py-2 text-xs flex items-center gap-2"><QrCode size={14} /> Pair a device</button>
      </div>

      {pairing && (
        <div className="mt-4 panel-subtle rounded-xl p-4 flex flex-col sm:flex-row items-center gap-4">
          <div ref={svgRef} data-testid="pairing-qr" className="h-32 w-32 shrink-0 bg-white rounded-lg flex items-center justify-center [&_svg]:h-full [&_svg]:w-full" />
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">{pairing.status}</p>
            {pairing.url && (
              <button type="button" data-testid="button-copy-pair-url" onClick={() => { navigator.clipboard?.writeText(pairing.url); onNotify('Pairing link copied.'); }} className="text-xs text-primary flex items-center gap-1 mt-2 break-all text-left">
                <Copy size={12} className="shrink-0" /> {pairing.url}
              </button>
            )}
          </div>
        </div>
      )}

      <div className="mt-4">
        {isLoading ? <p className="text-xs text-muted-foreground">Loading devices…</p>
          : devices.length ? devices.map((device) => <DeviceRow key={device.id} device={device} onNotify={onNotify} />)
          : <p className="text-xs text-muted-foreground">No paired devices yet.</p>}
      </div>
    </section>
  );
}

export function Security({ onNotify }: { onNotify: (message: string) => void }) {
  return (
    <div className="animate-enter">
      <ViewHeader eyebrow="Account / Security" title="Keep the room safe." description="Your account, your listeners, your unreleased work — protected without getting in the way." />
      <div className="max-w-3xl space-y-4">
        <TwoFactorSection onNotify={onNotify} />
        <DevicesSection onNotify={onNotify} />
      </div>
    </div>
  );
}
