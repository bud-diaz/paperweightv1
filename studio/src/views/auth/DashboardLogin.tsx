import { type FormEvent, useEffect, useState } from 'react';
import { ChevronLeft, LockKeyhole } from 'lucide-react';

import { Logo } from '@/components/Logo';
import { useDashboardAuth } from '@/lib/auth/DashboardAuthContext';

function Shell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[70] modal-backdrop flex items-center justify-center p-5" role="dialog" aria-modal="true">
      <button type="button" aria-label="Close dialog backdrop" data-testid="button-close-dialog-backdrop" className="absolute inset-0 cursor-default" onClick={onClose} />
      <div className="relative w-full max-w-sm modal-panel rounded-3xl p-7 sm:p-8 animate-enter">
        <a href="https://paperweighthq.com" target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 mb-7">
          <Logo size={36} />
          <div>
            <p className="font-mono-ui text-[9px] uppercase tracking-[.18em] text-muted-foreground">Paperweight:</p>
            <p className="font-display font-bold tracking-[-.03em] text-lg">STUDIO</p>
          </div>
        </a>
        {children}
      </div>
    </div>
  );
}

function TwoFactorChallenge({ onClose }: { onClose: () => void }) {
  const { verify2fa, cancel2fa } = useDashboardAuth();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const cleaned = code.trim().replace(/\s/g, '');
    if (!cleaned) return;
    setBusy(true);
    setError('');
    const result = await verify2fa(cleaned);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      setCode('');
    }
  };

  return (
    <Shell onClose={onClose}>
      <div className="flex items-center gap-2 mb-1"><LockKeyhole size={14} className="text-primary" /><p className="font-mono-ui text-[10px] uppercase tracking-[.2em] text-primary">Two-factor code</p></div>
      <h1 className="font-display text-2xl font-semibold mt-2">One more thing.</h1>
      <p className="text-sm text-muted-foreground mt-2">Enter the 6-digit code from your authenticator app.</p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <input
          autoFocus
          inputMode="numeric"
          data-testid="input-dashboard-2fa-code"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="000000"
          className="input-studio w-full rounded-xl px-3.5 py-3 text-center text-lg tracking-[.3em] font-mono-ui"
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
        <button type="submit" data-testid="button-dashboard-2fa-verify" disabled={busy} className="lime-button w-full rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-50">{busy ? 'Verifying…' : 'Verify'}</button>
        <button type="button" data-testid="button-dashboard-2fa-back" onClick={cancel2fa} className="w-full text-xs text-muted-foreground flex items-center justify-center gap-1"><ChevronLeft size={13} /> Start over</button>
      </form>
    </Shell>
  );
}

function TokenForm({ onClose }: { onClose: () => void }) {
  const { login } = useDashboardAuth();
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = token.trim();
    if (!value) return;
    setBusy(true);
    setError('');
    const result = await login(value);
    setBusy(false);
    if (!result.ok) setError(result.error);
  };

  return (
    <Shell onClose={onClose}>
      <h1 className="font-display text-2xl font-semibold">Your room, when you’re ready.</h1>
      <p className="text-sm text-muted-foreground mt-2">Enter your dashboard token to open the studio.</p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <input
          autoFocus
          type="password"
          autoComplete="current-password"
          data-testid="input-dashboard-token"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder="Dashboard token"
          className="input-studio w-full rounded-xl px-3.5 py-3 text-sm"
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
        <button type="submit" data-testid="button-dashboard-unlock" disabled={busy} className="lime-button w-full rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-50">{busy ? 'Checking…' : 'Unlock'}</button>
      </form>
    </Shell>
  );
}

export function DashboardLogin({ onClose }: { onClose: () => void }) {
  const { status } = useDashboardAuth();
  return status === 'needs2fa' ? <TwoFactorChallenge onClose={onClose} /> : <TokenForm onClose={onClose} />;
}
