import { useEffect, useState } from 'react';

import { useListenerAuth } from '@/lib/auth/ListenerAuthContext';

// Ports client/js/tour.js's one-time spotlight pointing new listener
// accounts at the Account button. "Seen" state is persisted server-side
// (listener_accounts.settings_tour_seen_at) so it survives across devices
// and shows exactly once per account, ever — mirrors that same read/write
// path via useListenerAuth's settingsTourSeenAt / settingsTourSeen().
export function SettingsTour({ suppressed }: { suppressed?: boolean }) {
  const { state, ready, settingsTourSeen } = useListenerAuth();
  const [rect, setRect] = useState<DOMRect | null>(null);
  const eligible = ready && state.loggedIn && state.hasAccount && !state.settingsTourSeenAt && !suppressed;

  useEffect(() => {
    if (!eligible) { setRect(null); return; }
    const target = document.querySelector<HTMLElement>('[data-testid="button-account"]');
    if (!target) return;
    const targetRect = target.getBoundingClientRect();
    if (!targetRect.width) return; // not visible (e.g. layout hides it) — skip silently
    setRect(targetRect);
  }, [eligible]);

  if (!rect) return null;

  const pad = 6;
  const dismiss = () => { setRect(null); settingsTourSeen(); };

  return (
    <div className="fixed inset-0 z-[85]">
      <div
        className="fixed rounded-lg pointer-events-none"
        style={{ left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2, boxShadow: '0 0 0 2000px rgba(0,0,0,.78), 0 0 0 2px #c84b20' }}
      />
      <div className="fixed panel rounded-xl p-3.5" style={{ right: Math.max(12, window.innerWidth - rect.right), top: rect.bottom + pad + 8, maxWidth: 220 }}>
        <p className="text-xs text-white/85 leading-relaxed mb-3">New: manage your account, email verification, and preferences here.</p>
        <button type="button" data-testid="button-settings-tour-dismiss" onClick={dismiss} className="lime-button rounded-md px-3.5 py-1.5 text-[11px] font-semibold tracking-wide">GOT IT</button>
      </div>
    </div>
  );
}
