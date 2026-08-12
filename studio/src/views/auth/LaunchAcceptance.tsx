import { useEffect, useState } from 'react';

import * as api from '@/lib/api';

// First-launch legal acceptance gate, ported from the #launch-backdrop modal
// in client/creator.html (client/js/dashboard/index.js checkLaunchAcceptance /
// launch-continue handler). Shown once per install, right after a dashboard
// session is established.
export function LaunchAcceptanceGate({ children }: { children: React.ReactNode }) {
  const [accepted, setAccepted] = useState<boolean | null>(null);
  const [license, setLicense] = useState(false);
  const [content, setContent] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.dashboard.system.launchStatus().then((data: { accepted: boolean }) => {
      if (!cancelled) setAccepted(!!data.accepted);
    }).catch(() => { if (!cancelled) setAccepted(true); });
    return () => { cancelled = true; };
  }, []);

  const canContinue = license && content;

  const accept = async () => {
    setBusy(true);
    try { await api.dashboard.system.launchAccept(); } catch { /* best-effort */ }
    setBusy(false);
    setAccepted(true);
  };

  if (accepted === false) {
    return (
      <div className="fixed inset-0 z-[100] modal-backdrop flex items-center justify-center p-5">
        <div className="w-full max-w-md panel rounded-2xl p-7 animate-enter">
          <p className="font-mono-ui text-[10px] uppercase tracking-[.2em] text-primary">Paperweight</p>
          <h2 className="font-display text-2xl font-semibold mt-2">Before you begin.</h2>
          <p className="text-sm text-muted-foreground mt-3 leading-relaxed">
            By using Paperweight, you agree to the Paperweight License Agreement and
            acknowledge that you are solely responsible for the legality and ownership
            of all content distributed through the software.
          </p>
          <div className="space-y-3 mt-5">
            <label className="flex gap-3 items-start text-xs text-muted-foreground">
              <input type="checkbox" data-testid="checkbox-launch-license" checked={license} onChange={(event) => setLicense(event.target.checked)} className="accent-primary mt-0.5" />
              I have read and agree to the <a href="/landing/license" target="_blank" rel="noopener noreferrer" className="text-primary">Paperweight License Agreement</a>
            </label>
            <label className="flex gap-3 items-start text-xs text-muted-foreground">
              <input type="checkbox" data-testid="checkbox-launch-content" checked={content} onChange={(event) => setContent(event.target.checked)} className="accent-primary mt-0.5" />
              I understand and accept my <a href="/landing/content-responsibility" target="_blank" rel="noopener noreferrer" className="text-primary">Content Responsibility</a>
            </label>
          </div>
          <button type="button" data-testid="button-launch-continue" disabled={!canContinue || busy} onClick={accept} className="lime-button w-full rounded-xl px-4 py-2.5 text-sm font-semibold mt-6 disabled:opacity-40">
            Continue →
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
