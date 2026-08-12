import { useState } from 'react';
import { LogOut, ShieldCheck } from 'lucide-react';

import { Field, Modal } from '@/components/primitives';
import { useListenerAuth } from '@/lib/auth/ListenerAuthContext';
import { cn } from '@/lib/utils';

// Ports client/js/auth.js's account panel + client/js/settings.js's
// verification/preferences rows into one modal — the single entry point for
// login, register, and account management in the public listener shell.
export function AccountModal({ onClose, onNotify, initialTab, initialEmail }: { onClose: () => void; onNotify: (message: string) => void; initialTab?: 'login' | 'register'; initialEmail?: string }) {
  const auth = useListenerAuth();
  const { state } = auth;
  const [tab, setTab] = useState<'login' | 'register'>(initialTab || 'login');
  const [email, setEmail] = useState(initialEmail || '');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  const [showSetPassword, setShowSetPassword] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [setPwPending, setSetPwPending] = useState(false);
  const [setPwMsg, setSetPwMsg] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  const [manageMsg, setManageMsg] = useState<{ type: 'error' | 'success'; text: string } | null>(null);
  const [resendPending, setResendPending] = useState(false);
  const [resendSent, setResendSent] = useState(false);

  async function submitAuth() {
    if (!email || !password) { setMsg({ type: 'error', text: 'Email and password are required.' }); return; }
    setPending(true);
    setMsg(null);
    const result = tab === 'login' ? await auth.login(email, password) : await auth.register(email, password);
    setPending(false);
    if (!result.ok) { setMsg({ type: 'error', text: result.error }); return; }
    setMsg({ type: 'success', text: tab === 'login' ? 'Logged in!' : 'Account created!' });
    setEmail('');
    setPassword('');
  }

  async function handleForgotPassword() {
    if (!email || !email.includes('@')) { setMsg({ type: 'error', text: 'Enter your email above first, then click forgot password.' }); return; }
    const result = await auth.requestPasswordReset(email);
    if (!result.ok) { setMsg({ type: 'error', text: result.error }); return; }
    setMsg({ type: 'success', text: result.emailEnabled ? 'If an account exists for that email, a reset link is on its way.' : 'This station has no email set up — ask the creator to generate a reset link for you.' });
  }

  async function handleSetPassword() {
    if (!newPassword || newPassword.length < 8) { setSetPwMsg({ type: 'error', text: 'Password must be at least 8 characters.' }); return; }
    setSetPwPending(true);
    const result = await auth.setPassword(newPassword);
    setSetPwPending(false);
    if (!result.ok) { setSetPwMsg({ type: 'error', text: result.error }); return; }
    setSetPwMsg({ type: 'success', text: 'Password set — you can now log in from any device.' });
    setNewPassword('');
    setTimeout(() => { setShowSetPassword(false); setSetPwMsg(null); }, 3000);
  }

  async function handleResendVerification() {
    setResendPending(true);
    await auth.resendVerification();
    setResendPending(false);
    setResendSent(true);
    setTimeout(() => setResendSent(false), 3000);
  }

  async function handleMarketingToggle(checked: boolean) {
    const result = await auth.updatePreferences({ marketingOptIn: checked });
    if (!result.ok) onNotify(result.error);
  }

  async function handleCancelSubscription() {
    if (!window.confirm('Cancel your subscription? You keep access until the end of the paid period.')) return;
    const result = await auth.cancelSubscription();
    if (!result.ok) { setManageMsg({ type: 'error', text: result.error }); return; }
    setManageMsg({ type: 'success', text: result.effectiveUntil ? `Cancelled — access continues until ${new Date(result.effectiveUntil).toLocaleDateString()}.` : 'Cancellation requested — your provider will process it shortly.' });
  }

  async function handleBillingPortal() {
    const result = await auth.billingPortal();
    if (!result.ok) { setManageMsg({ type: 'error', text: result.error }); return; }
    window.open(result.url, '_blank');
  }

  async function handleDeleteProfile() {
    if (!window.confirm('Delete your listener profile? This removes your display name and any saved email. This cannot be undone.')) return;
    const result = await auth.deleteProfile();
    if (!result.ok) { setManageMsg({ type: 'error', text: result.error }); return; }
    onNotify('Profile deleted.');
    onClose();
  }

  async function handleDeleteAccount() {
    if (!window.confirm('Permanently delete your account? Unlocked content and subscriptions will be lost. This cannot be undone.')) return;
    const body: { password?: string; confirmEmail?: string } = {};
    if (state.hasPassword) {
      const pw = window.prompt('Enter your password to confirm deletion:');
      if (!pw) return;
      body.password = pw;
    } else {
      const confirmEmail = window.prompt('Type your account email to confirm deletion:');
      if (!confirmEmail) return;
      body.confirmEmail = confirmEmail;
    }
    const result = await auth.deleteAccount(body);
    if (!result.ok) { setManageMsg({ type: 'error', text: result.error }); return; }
    onNotify((result.warnings || []).join(' ') || 'Account deleted.');
    onClose();
  }

  async function handleLogout() {
    await auth.logout();
    onNotify('Logged out.');
    onClose();
  }

  if (state.loggedIn) {
    const isProfile = !state.hasAccount && !!state.displayName;
    const hasAccount = !!state.hasAccount;
    const activeSub = state.subscriptionStatus === 'active';
    const needsPassword = state.tier !== 'free' && !state.hasPassword;

    return <Modal title="Your account." eyebrow="Account" onClose={onClose}>
      <div className="space-y-5">
        <div className="panel-subtle rounded-xl p-4 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{state.email || state.displayName || '—'}</p>
            <p className={cn('font-mono-ui text-[10px] uppercase tracking-[.15em] mt-1', state.tier === 'free' ? 'text-muted-foreground' : 'text-primary')}>{state.tier.replace('_', ' ')}</p>
          </div>
        </div>

        {needsPassword && !showSetPassword && <button type="button" data-testid="button-open-set-password" onClick={() => setShowSetPassword(true)} className="ghost-button rounded-lg px-3 py-2 text-xs w-full">Set a password to log in from another device</button>}
        {needsPassword && showSetPassword && <div className="space-y-3">
          <Field label="New password" value={newPassword} onChange={setNewPassword} placeholder="8+ characters" />
          {setPwMsg && <p className={cn('text-xs', setPwMsg.type === 'error' ? 'text-destructive' : 'text-primary')}>{setPwMsg.text}</p>}
          <button type="button" data-testid="button-set-password" onClick={handleSetPassword} disabled={setPwPending} className="lime-button rounded-lg px-3 py-2 text-xs font-semibold w-full disabled:opacity-50">{setPwPending ? 'Saving…' : 'Set password'}</button>
        </div>}

        {isProfile && <p className="text-xs text-muted-foreground">Create a full account to keep purchases and unlocks across devices.</p>}

        {hasAccount && <div className="flex items-center justify-between panel-subtle rounded-xl p-4">
          <div className="flex items-center gap-2 text-sm"><ShieldCheck size={15} className={state.emailVerified ? 'text-primary' : 'text-muted-foreground'} /> {state.emailVerified ? 'Email verified' : 'Email not verified yet'}</div>
          {!state.emailVerified && <button type="button" data-testid="button-resend-verification" onClick={handleResendVerification} disabled={resendPending || resendSent} className="ghost-button rounded-lg px-2.5 py-1.5 text-xs disabled:opacity-50">{resendSent ? 'Sent' : resendPending ? '…' : 'Resend'}</button>}
        </div>}

        {hasAccount && <label className="flex items-center gap-3 text-sm"><input type="checkbox" data-testid="checkbox-marketing-optin" defaultChecked={state.marketingOptIn} onChange={(event) => handleMarketingToggle(event.target.checked)} className="accent-primary" /> Send me updates and releases from this station</label>}

        {manageMsg && <p className={cn('text-xs', manageMsg.type === 'error' ? 'text-destructive' : 'text-primary')}>{manageMsg.text}</p>}

        <div className="flex flex-wrap gap-2 pt-3 border-t border-white/[.08]">
          {hasAccount && activeSub && <button type="button" data-testid="button-cancel-subscription" onClick={handleCancelSubscription} className="ghost-button rounded-lg px-3 py-2 text-xs">Cancel subscription</button>}
          {hasAccount && activeSub && state.provider === 'stripe' && <button type="button" data-testid="button-billing-portal" onClick={handleBillingPortal} className="ghost-button rounded-lg px-3 py-2 text-xs">Billing portal</button>}
          {(hasAccount || isProfile) && <a href="/api/listener/export" data-testid="link-export-data" className="ghost-button rounded-lg px-3 py-2 text-xs inline-flex items-center">Export my data</a>}
          {isProfile && <button type="button" data-testid="button-delete-profile" onClick={handleDeleteProfile} className="ghost-button rounded-lg px-3 py-2 text-xs text-destructive">Delete profile</button>}
          {hasAccount && <button type="button" data-testid="button-delete-account" onClick={handleDeleteAccount} className="ghost-button rounded-lg px-3 py-2 text-xs text-destructive">Delete account</button>}
        </div>

        <button type="button" data-testid="button-listener-logout" onClick={handleLogout} className="ghost-button rounded-lg px-3 py-2 text-xs w-full flex items-center justify-center gap-2"><LogOut size={13} /> Log out</button>
      </div>
    </Modal>;
  }

  return <Modal title="Your account." eyebrow="Account" onClose={onClose}>
    <div className="grid grid-cols-2 gap-2 mb-6 panel-subtle rounded-xl p-1">
      <button type="button" data-testid="tab-login" onClick={() => { setTab('login'); setMsg(null); }} className={cn('rounded-lg py-2 text-xs font-semibold', tab === 'login' ? 'bg-primary text-black' : 'text-muted-foreground')}>Log in</button>
      <button type="button" data-testid="tab-register" onClick={() => { setTab('register'); setMsg(null); }} className={cn('rounded-lg py-2 text-xs font-semibold', tab === 'register' ? 'bg-primary text-black' : 'text-muted-foreground')}>Create account</button>
    </div>
    <div className="space-y-4">
      <Field label="Email" value={email} onChange={setEmail} placeholder="you@example.com" />
      <Field label="Password" value={password} onChange={setPassword} placeholder={tab === 'register' ? '8+ characters' : 'Your password'} />
      {tab === 'login' && <button type="button" data-testid="button-forgot-password" onClick={handleForgotPassword} className="text-xs text-primary">Forgot password?</button>}
      {msg && <p className={cn('text-xs', msg.type === 'error' ? 'text-destructive' : 'text-primary')}>{msg.text}</p>}
      <button type="button" data-testid="button-submit-auth" onClick={submitAuth} disabled={pending} className="lime-button rounded-lg px-4 py-2.5 text-sm font-semibold w-full disabled:opacity-50">{pending ? '…' : tab === 'login' ? 'Log in' : 'Create account'}</button>
    </div>
  </Modal>;
}
