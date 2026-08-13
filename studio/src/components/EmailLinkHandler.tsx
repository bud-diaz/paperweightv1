import { useEffect, useState } from 'react';

import { useListenerAuth } from '@/lib/auth/ListenerAuthContext';
import { cn } from '@/lib/utils';

type LinkKind = { type: 'verify' | 'autologin'; token: string } | { type: 'reset'; token: string } | null;

function parseHash(hash: string): LinkKind {
  const verify = hash.match(/^#verify=([A-Za-z0-9]+)$/);
  if (verify) return { type: 'verify', token: verify[1] };
  const autologin = hash.match(/^#autologin=([A-Za-z0-9]+)$/);
  if (autologin) return { type: 'autologin', token: autologin[1] };
  const reset = hash.match(/^#reset=([A-Za-z0-9]+)$/);
  if (reset) return { type: 'reset', token: reset[1] };
  return null;
}

function clearHash() {
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
}

// Ports client/js/auth.js's maybeShowResetForm()/maybeHandleEmailLink(): the
// entry points a listener hits from an emailed verify/auto-login/reset link.
// Independent of whatever else is on screen — mounted once at the shell root
// so the link works no matter which mode (Stack/Play) the app happens to be
// in when it loads.
export function EmailLinkHandler({ onNotify }: { onNotify: (message: string) => void }) {
  const auth = useListenerAuth();
  const [link] = useState<LinkKind>(() => (typeof window !== 'undefined' ? parseHash(window.location.hash) : null));
  const [status, setStatus] = useState<'working' | 'done' | 'error'>('working');
  const [statusText, setStatusText] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [resetPending, setResetPending] = useState(false);
  const [resetMsg, setResetMsg] = useState<{ type: 'error' | 'success'; text: string } | null>(null);
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    if (!link || link.type === 'reset') return;
    (async () => {
      const result = link.type === 'autologin' ? await auth.autoLogin(link.token) : await auth.verifyEmail(link.token);
      if (!result.ok) {
        setStatus('error');
        setStatusText(result.error);
        window.setTimeout(() => { clearHash(); setClosed(true); }, 3000);
        return;
      }
      setStatus('done');
      setStatusText(link.type === 'autologin' ? "You're logged in!" : 'Email verified!');
      window.setTimeout(() => { clearHash(); setClosed(true); }, 1400);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link]);

  async function submitReset() {
    if (link?.type !== 'reset') return;
    if (!newPassword || newPassword.length < 8) { setResetMsg({ type: 'error', text: 'Password must be at least 8 characters.' }); return; }
    setResetPending(true);
    const result = await auth.resetPassword(link.token, newPassword);
    setResetPending(false);
    if (!result.ok) { setResetMsg({ type: 'error', text: result.error }); return; }
    setResetMsg({ type: 'success', text: 'Password updated — you can now log in.' });
    onNotify('Password updated.');
    window.setTimeout(() => { clearHash(); setClosed(true); }, 1400);
  }

  if (!link || closed) return null;

  if (link.type === 'reset') {
    return (
      <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-md flex items-center justify-center p-5" role="dialog" aria-modal="true">
        <div className="w-full max-w-sm panel rounded-2xl p-7">
          <p className="font-mono-ui text-[10px] uppercase tracking-[.22em] text-primary">Choose a new password</p>
          <input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="new password (min 8 chars)" autoComplete="new-password" data-testid="input-reset-password" className="input-studio w-full rounded-xl px-3.5 py-3 mt-4 text-sm" />
          {resetMsg && <p className={cn('text-xs mt-3', resetMsg.type === 'error' ? 'text-destructive' : 'text-primary')}>{resetMsg.text}</p>}
          <button type="button" data-testid="button-submit-reset" onClick={submitReset} disabled={resetPending} className="lime-button rounded-xl w-full py-3 text-sm font-semibold mt-4 disabled:opacity-50">{resetPending ? '…' : 'Set new password'}</button>
          <button type="button" data-testid="button-cancel-reset" onClick={() => { clearHash(); setClosed(true); }} className="text-xs text-muted-foreground mt-4">Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-md flex items-center justify-center p-5" role="dialog" aria-modal="true">
      <div className="w-full max-w-sm panel rounded-2xl p-7 text-center">
        <p className="font-mono-ui text-[10px] uppercase tracking-[.22em] text-primary">{status === 'working' ? (link.type === 'autologin' ? 'Logging you in…' : 'Verifying your email…') : ''}</p>
        {statusText && <p className={cn('text-sm mt-3', status === 'error' ? 'text-destructive' : 'text-primary')}>{statusText}</p>}
      </div>
    </div>
  );
}
