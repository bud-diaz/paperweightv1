import { useState } from 'react';

import { useListenerAuth } from '@/lib/auth/ListenerAuthContext';
import { cn } from '@/lib/utils';

const DISMISS_KEY = 'pw_welcome_done';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isWelcomeDismissed() {
  try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
}

export function markWelcomeDismissed() {
  try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* localStorage unavailable */ }
}

// Ports client/js/welcome.js's first-visit Papercut-style onboarding: entering
// the station creates a full listener account (email unlocks the higher free
// on-demand play allowance); "Just listen" dismisses without creating
// anything so the public stream stays frictionless.
export function WelcomeOverlay({ stationName, onDismiss, onOpenLogin }: { stationName: string; onDismiss: () => void; onOpenLogin: (prefillEmail?: string) => void }) {
  const auth = useListenerAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [optIn, setOptIn] = useState(false);
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ type: 'error' | 'success'; text: string } | null>(null);
  const [loginHint, setLoginHint] = useState(false);

  const valid = !!name.trim() && EMAIL_RE.test(email.trim()) && password.length >= 8;

  function dismiss() { markWelcomeDismissed(); onDismiss(); }

  async function enter() {
    if (!valid) return;
    setPending(true);
    setMsg(null);
    const result = await auth.register(email.trim(), password, { displayName: name.trim(), marketingOptIn: optIn });
    setPending(false);
    if (!result.ok) {
      setMsg({ type: 'error', text: result.error });
      if (result.error.toLowerCase().includes('exist')) setLoginHint(true);
      return;
    }
    dismiss();
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center p-5" role="dialog" aria-modal="true">
      <div className="w-full max-w-sm panel rounded-2xl p-7">
        <p className="font-mono-ui text-[10px] uppercase tracking-[.22em] text-primary">Welcome to</p>
        <h1 className="font-display text-3xl font-semibold mt-2">{stationName || 'Paperweight'}</h1>
        <p className="text-sm text-muted-foreground mt-2">Independent broadcasting, direct from the creator.</p>

        <div className="space-y-4 mt-6">
          <label className="block text-sm text-muted-foreground">Choose a display name<input value={name} onChange={(event) => setName(event.target.value)} maxLength={50} placeholder="e.g. Alex" autoComplete="nickname" className="input-studio w-full rounded-xl px-3.5 py-3 mt-2 text-sm" data-testid="input-welcome-name" /></label>
          <label className="block text-sm text-muted-foreground">Your email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" autoComplete="email" className="input-studio w-full rounded-xl px-3.5 py-3 mt-2 text-sm" data-testid="input-welcome-email" /></label>
          <label className="block text-sm text-muted-foreground">Choose a password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} placeholder="8+ characters" autoComplete="new-password" className="input-studio w-full rounded-xl px-3.5 py-3 mt-2 text-sm" data-testid="input-welcome-password" /></label>
          <label className="flex items-start gap-3 text-xs text-muted-foreground"><input type="checkbox" checked={optIn} onChange={(event) => setOptIn(event.target.checked)} className="accent-primary mt-0.5" data-testid="checkbox-welcome-optin" /> Send me updates and releases from this station</label>
        </div>

        {msg && <p className={cn('text-xs mt-4', msg.type === 'error' ? 'text-destructive' : 'text-primary')}>{msg.text}</p>}

        <button type="button" data-testid="button-welcome-enter" onClick={enter} disabled={!valid || pending} className="lime-button rounded-xl w-full py-3 text-sm font-semibold mt-5 disabled:opacity-40">{pending ? '…' : 'Enter station →'}</button>

        <div className="flex flex-col items-center gap-2 mt-5 pt-4 border-t border-white/[.08]">
          <button type="button" data-testid="button-welcome-login" onClick={() => { markWelcomeDismissed(); onOpenLogin(loginHint ? email.trim() : undefined); }} className={cn('text-xs', loginHint ? 'text-primary font-semibold' : 'text-muted-foreground')}>Already have an account? Log in</button>
          <button type="button" data-testid="button-welcome-skip" onClick={dismiss} className="text-xs text-muted-foreground">Just listen →</button>
        </div>
      </div>
    </div>
  );
}
