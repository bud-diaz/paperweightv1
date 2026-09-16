import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Cloud, Copy, Globe2, Loader2, RadioTower, Search, ShieldCheck } from 'lucide-react';

import { Field, ViewHeader } from '@/components/primitives';
import * as api from '@/lib/api';

type StationData = {
  slug?: string;
  url?: string;
  searchable?: boolean;
  telemetryConfigured?: boolean;
  paperweighthqTunnelAvailable?: boolean;
  cloudflareTunnelPaused?: boolean;
  cloudflareApiConfigured?: boolean;
  cloudflareTunnelManaged?: boolean;
  requirements?: { cloudflareTunnel?: boolean; publicUrlSet?: boolean };
  appListing?: { eligible?: boolean; reason?: string; checkedAt?: string | null };
};
type Health = { reachable?: boolean; latencyMs?: number; error?: string };
type Zone = { id: string; name: string };
type SetupProgress = { milestones?: Record<string, boolean>; signupDismissed?: boolean };

// Read-only mirror of System.Pape's verdict on this station's mobile-app
// listing. There is deliberately no toggle: eligibility is decided upstream, in
// the closed control plane, because anything gated in this open-source server
// could be patched by whoever runs it. The creator sees the reason so they know
// what (if anything) is theirs to fix.
const APP_LISTING_COPY: Record<string, string> = {
  ok: 'Listed in the Paperweight app.',
  not_searchable: 'Turn on station search above to appear in the app.',
  no_public_url: 'Register a public URL to appear in the app.',
  no_slug: 'Claim a station slug to appear in the app.',
  no_subscription: 'Requires an app-listing subscription.',
  past_due: 'Payment past due — update billing to stay listed.',
  canceled: 'App-listing subscription canceled.',
  stale: 'No recent telemetry reached PaperweightHQ.',
  suspended: 'Removed from the app. Contact support.',
  unreported: 'Not reported yet — needs telemetry configured.',
  unknown: 'Status unavailable.',
};

// Reasons a purchase actually resolves. Deliberately excludes the creator's own
// configuration (they need the toggle above, not a card) and 'suspended', which
// is a moderation decision that paying again would not lift.
const BILLABLE_REASONS = new Set(['no_subscription', 'canceled', 'past_due']);

function appListingText(data?: StationData): string {
  const listing = data?.appListing;
  if (!listing) return APP_LISTING_COPY.unreported;
  return APP_LISTING_COPY[listing.reason || 'unknown'] || APP_LISTING_COPY.unknown;
}

const SETUP_STEPS = [
  ['install_completed', 'Installed and running'],
  ['first_track_scanned', 'First track added to your vault'],
  ['went_public', 'Station went public'],
  ['first_listener', 'First listener tuned in'],
];

function statusText(data?: StationData) {
  if (!data?.slug) return 'Unclaimed';
  if (data.cloudflareTunnelPaused) return 'Tunnel paused';
  if (data.requirements?.cloudflareTunnel && data.requirements?.publicUrlSet) return 'Public routing ready';
  return 'Local setup';
}

export function Station({ onNotify }: { onNotify: (message: string) => void }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery<StationData>({ queryKey: ['dashboard', 'station'], queryFn: () => api.dashboard.station.get() });
  const { data: health, refetch: refetchHealth, isFetching: healthFetching } = useQuery<Health>({ queryKey: ['dashboard', 'station', 'health'], queryFn: () => api.dashboard.station.health(), enabled: !!data?.url });
  const { data: setup } = useQuery<SetupProgress>({ queryKey: ['dashboard', 'setup-progress'], queryFn: () => api.dashboard.setupProgress() });
  const { data: zonesData } = useQuery<{ zones: Zone[] }>({ queryKey: ['dashboard', 'station', 'cloudflare', 'zones'], queryFn: () => api.dashboard.station.cloudflareZones(), retry: false, enabled: !!data?.cloudflareApiConfigured });
  const { data: tunnelStatus } = useQuery<{ status?: string; lastError?: string | null; running?: boolean }>({ queryKey: ['dashboard', 'station', 'tunnel-status'], queryFn: () => api.dashboard.station.getTunnelStatus(), refetchInterval: 5000, enabled: !!(data?.cloudflareApiConfigured || data?.cloudflareTunnelManaged) });
  const [publicUrl, setPublicUrl] = useState('');
  const [apiToken, setApiToken] = useState('');
  const [zoneId, setZoneId] = useState('');
  const [hostname, setHostname] = useState('');
  const [telemetrySecret, setTelemetrySecret] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [claimCode, setClaimCode] = useState('');

  useEffect(() => { setPublicUrl(data?.url || ''); }, [data?.url]);
  useEffect(() => { if (!zoneId && zonesData?.zones?.[0]) setZoneId(zonesData.zones[0].id); }, [zoneId, zonesData?.zones]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['dashboard', 'station'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard', 'station', 'health'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard', 'station', 'cloudflare'] });
  };
  const wrapMutation = (message: string) => ({
    onSuccess: ({ res, data: result }: { res: Response; data: { error?: string; url?: string; note?: string } }) => {
      if (!res.ok) { onNotify(result.error || 'Station update failed.'); return; }
      if (result.url) setPublicUrl(result.url);
      invalidate();
      onNotify(result.note || message);
    },
    onError: () => onNotify('Station update failed.'),
  });

  const updateUrl = useMutation({ mutationFn: () => api.dashboard.station.updateUrl(publicUrl.trim()), ...wrapMutation('Public URL updated.') });
  const saveToken = useMutation({ mutationFn: () => api.dashboard.station.saveCloudflareToken(apiToken.trim()), ...wrapMutation('Cloudflare token saved and verified.') });
  const autoTunnel = useMutation({ mutationFn: () => api.dashboard.station.autoCreateTunnel(zoneId, hostname.trim()), ...wrapMutation('Tunnel created. Connector is starting.') });
  const hqTunnel = useMutation({ mutationFn: () => api.dashboard.station.createFrpPaperweighthqTunnelWithRegistration(), ...wrapMutation('PaperweightHQ tunnel created. Connector is starting.') });
  const saveSecret = useMutation({ mutationFn: () => api.dashboard.station.saveTelemetrySecret(telemetrySecret.trim()), ...wrapMutation('Telemetry secret saved.') });
  const registerTelemetry = useMutation({ mutationFn: () => api.dashboard.station.registerTelemetry(), ...wrapMutation('Registered with PaperweightHQ.') });
  const toggleTunnel = useMutation({
    mutationFn: () => data?.cloudflareTunnelPaused ? api.dashboard.station.tunnelConnect() : api.dashboard.station.tunnelDisconnect(),
    ...wrapMutation(data?.cloudflareTunnelPaused ? 'Tunnel reconnected.' : 'Tunnel disconnected.'),
  });
  // Opens a hosted Stripe page. Kept off wrapMutation on purpose — that helper
  // treats a returned `url` as a new public station URL and would overwrite the
  // Public URL field with a checkout link.
  const openHostedUrl = (label: string) => ({
    onSuccess: ({ res, data: result }: { res: Response; data: { error?: string; url?: string } }) => {
      if (!res.ok || !result.url) { onNotify(result.error || `Could not open ${label}.`); return; }
      const opened = window.open(result.url, '_blank', 'noopener,noreferrer');
      if (!opened) onNotify(`Allow pop-ups to open ${label}, or copy this link: ${result.url}`);
    },
    onError: () => onNotify(`Could not open ${label}.`),
  });

  const startCheckout = useMutation({
    mutationFn: () => api.dashboard.station.appListingCheckout(),
    ...openHostedUrl('checkout'),
  });
  const openBillingPortal = useMutation({
    mutationFn: () => api.dashboard.station.appListingPortal(),
    ...openHostedUrl('the billing portal'),
  });
  const redeemClaim = useMutation({
    mutationFn: () => api.dashboard.station.appListingClaim(claimCode.trim()),
    onSuccess: ({ res, data: result }: { res: Response; data: { error?: string } }) => {
      if (!res.ok) { onNotify(result.error || 'That claim code could not be redeemed.'); return; }
      setClaimCode('');
      invalidate();
      onNotify('Claim code redeemed. Your station is now listed in the app.');
    },
    onError: () => onNotify('That claim code could not be redeemed.'),
  });

  const searchable = useMutation({
    mutationFn: (enabled: boolean) => api.dashboard.station.setSearchable(enabled),
    onSuccess: ({ res, data: result }: { res: Response; data: { error?: string; checks?: Record<string, boolean> } }) => {
      if (!res.ok) {
        const failed = Object.entries(result.checks || {}).filter(([, ok]) => ok === false).map(([key]) => key).join(', ');
        onNotify(`${result.error || 'Could not update searchability'}${failed ? ` (${failed})` : ''}`);
        refetchHealth();
        return;
      }
      invalidate();
      onNotify('Directory searchability updated.');
    },
    onError: () => onNotify('Could not update searchability.'),
  });
  const signup = useMutation({ mutationFn: () => api.dashboard.signup(signupEmail.trim(), true), ...wrapMutation('Thanks, you are signed up.') });
  const dismissSignup = useMutation({ mutationFn: () => api.dashboard.dismissSignup(), onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['dashboard', 'setup-progress'] }); onNotify('Signup prompt dismissed.'); } });

  const missing = useMemo(() => {
    const req = data?.requirements || {};
    return [!req.cloudflareTunnel && 'a public tunnel connection', !req.publicUrlSet && 'a registered public URL'].filter(Boolean) as string[];
  }, [data?.requirements]);
  const milestones = setup?.milestones || {};
  const allDone = SETUP_STEPS.every(([key]) => milestones[key]);

  return <div className="animate-enter">
    <ViewHeader eyebrow="Studio / Station" title="Make the station reachable." description="Public URL, managed tunnel, directory searchability, and PaperweightHQ registration live here." />
    <div className="grid xl:grid-cols-[1fr_380px] gap-6">
      <div className="space-y-6">
        <section className="panel rounded-2xl p-5 sm:p-6">
          <div className="flex items-start gap-4">
            <span className="h-12 w-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center"><RadioTower size={21} /></span>
            <div className="flex-1 min-w-0">
              <p className="font-mono-ui text-[10px] uppercase tracking-[.2em] text-primary">{isLoading ? 'Loading' : statusText(data)}</p>
              <h2 className="font-display text-2xl font-semibold mt-1 truncate">{data?.slug || 'Station not claimed'}</h2>
              <p className="text-xs text-muted-foreground mt-2 break-all">{data?.url || 'No public URL registered yet.'}</p>
            </div>
            {data?.url && <button type="button" data-testid="button-copy-station-url" onClick={() => { navigator.clipboard?.writeText(data.url || ''); onNotify('Station URL copied.'); }} className="ghost-button rounded-lg px-3 py-2 text-xs flex items-center gap-2"><Copy size={14} /> Copy</button>}
          </div>
          <div className="grid sm:grid-cols-3 gap-3 mt-5">
            <div className="panel-subtle rounded-xl p-4"><p className="text-xs text-muted-foreground">Health</p><p className={health?.reachable ? 'text-primary mt-2 text-sm' : 'text-destructive mt-2 text-sm'}>{healthFetching ? 'Checking...' : health?.reachable ? `Reachable · ${health.latencyMs || 0}ms` : (health?.error || 'Unreachable')}</p></div>
            <div className="panel-subtle rounded-xl p-4"><p className="text-xs text-muted-foreground">Tunnel</p><p className="mt-2 text-sm">{tunnelStatus?.status || (data?.requirements?.cloudflareTunnel ? 'Configured' : 'Missing')}</p></div>
            <div className="panel-subtle rounded-xl p-4"><p className="text-xs text-muted-foreground">Directory</p><p className={data?.searchable ? 'text-primary mt-2 text-sm' : 'mt-2 text-sm'}>{data?.searchable ? 'Searchable' : 'Hidden'}</p></div>
          </div>
          <div className="flex flex-wrap gap-2 mt-5">
            <button type="button" data-testid="button-recheck-station-health" onClick={() => refetchHealth()} className="ghost-button rounded-lg px-3 py-2 text-xs">Recheck health</button>
            <button type="button" data-testid="button-toggle-tunnel" onClick={() => toggleTunnel.mutate()} disabled={!data?.requirements?.cloudflareTunnel || toggleTunnel.isPending} className="ghost-button rounded-lg px-3 py-2 text-xs disabled:opacity-50">{data?.cloudflareTunnelPaused ? 'Reconnect tunnel' : 'Disconnect tunnel'}</button>
          </div>
        </section>

        <section className="panel rounded-2xl p-5 sm:p-6">
          <div className="flex items-center gap-3 mb-4"><Globe2 size={18} className="text-primary" /><h2 className="font-display text-xl font-semibold">Public URL</h2></div>
          <div className="grid sm:grid-cols-[1fr_auto] gap-3">
            <Field label="Station public URL" value={publicUrl} onChange={setPublicUrl} placeholder="https://radio.yoursite.com" />
            <button type="button" data-testid="button-save-station-url" onClick={() => updateUrl.mutate()} disabled={!publicUrl.trim() || updateUrl.isPending} className="lime-button self-end rounded-xl px-4 py-3 text-xs font-semibold disabled:opacity-50">Save URL</button>
          </div>
        </section>

        <section className="panel rounded-2xl p-5 sm:p-6">
          <div className="flex items-center gap-3 mb-4"><Cloud size={18} className="text-primary" /><h2 className="font-display text-xl font-semibold">Cloudflare tunnel</h2></div>
          <Field label="Cloudflare API token" value={apiToken} onChange={setApiToken} placeholder="Paste a scoped Cloudflare token" />
          <button type="button" data-testid="button-save-cloudflare-token" onClick={() => saveToken.mutate()} disabled={!apiToken.trim() || saveToken.isPending} className="ghost-button rounded-lg px-3 py-2 text-xs mt-3 disabled:opacity-50">Save and verify token</button>
          {!!zonesData?.zones?.length && <div className="grid sm:grid-cols-[1fr_1fr_auto] gap-3 mt-5 items-end">
            <label className="block text-sm text-muted-foreground">Zone<select value={zoneId} onChange={(event) => setZoneId(event.target.value)} data-testid="select-cloudflare-zone" className="input-studio w-full rounded-xl px-3.5 py-3 mt-2">{zonesData.zones.map((zone) => <option key={zone.id} value={zone.id}>{zone.name}</option>)}</select></label>
            <Field label="Hostname" value={hostname} onChange={setHostname} placeholder="radio.yoursite.com" />
            <button type="button" data-testid="button-auto-create-tunnel" onClick={() => autoTunnel.mutate()} disabled={!zoneId || !hostname.trim() || autoTunnel.isPending} className="lime-button rounded-xl px-4 py-3 text-xs font-semibold disabled:opacity-50">Create tunnel</button>
          </div>}
          <div className="panel-subtle rounded-xl p-4 mt-5 flex flex-col sm:flex-row gap-3 sm:items-center">
            <div className="flex-1"><p className="text-sm font-medium">paperweighthq.com address</p><p className="text-xs text-muted-foreground mt-1">Provision a managed address for the claimed station slug.</p></div>
            <button type="button" data-testid="button-paperweighthq-tunnel" onClick={() => hqTunnel.mutate()} disabled={hqTunnel.isPending || data?.paperweighthqTunnelAvailable === false} className="ghost-button rounded-lg px-3 py-2 text-xs disabled:opacity-50">Get free address</button>
          </div>
        </section>
      </div>

      <aside className="space-y-6">
        <section className="panel rounded-2xl p-5 sm:p-6">
          <div className="flex items-center gap-3 mb-4"><Search size={18} className="text-primary" /><h2 className="font-display text-xl font-semibold">Station search</h2></div>
          <p className="text-xs text-muted-foreground">{missing.length ? `Requires ${missing.join(' and ')}.` : 'Reachability is verified when you switch this on.'}</p>
          <button type="button" role="switch" aria-checked={!!data?.searchable} data-testid="toggle-station-searchable" onClick={() => searchable.mutate(!data?.searchable)} disabled={!!missing.length || searchable.isPending} className={`mt-4 h-8 w-14 rounded-full p-1 transition-colors disabled:opacity-50 ${data?.searchable ? 'bg-primary' : 'bg-white/15'}`}><span className={`block h-6 w-6 rounded-full bg-[#171a28] transition-transform ${data?.searchable ? 'translate-x-6' : ''}`} /></button>
          <div className="panel-subtle rounded-xl p-4 mt-5" data-testid="status-app-listing">
            <p className="text-xs text-muted-foreground">Mobile app directory</p>
            <p className={data?.appListing?.eligible ? 'text-primary mt-2 text-sm' : 'mt-2 text-sm'}>{data?.appListing?.eligible ? 'Listed' : 'Not listed'}</p>
            <p className="text-xs text-muted-foreground mt-1">{appListingText(data)}</p>

            {data?.appListing?.eligible ? (
              <button type="button" data-testid="button-app-listing-portal" onClick={() => openBillingPortal.mutate()} disabled={openBillingPortal.isPending} className="ghost-button rounded-lg px-3 py-2 text-xs mt-3 disabled:opacity-50">Manage billing</button>
            ) : BILLABLE_REASONS.has(data?.appListing?.reason || '') ? (
              <div className="mt-3 space-y-3">
                <button type="button" data-testid="button-app-listing-subscribe" onClick={() => startCheckout.mutate()} disabled={startCheckout.isPending} className="lime-button w-full rounded-xl px-4 py-3 text-xs font-semibold disabled:opacity-50">{data?.appListing?.reason === 'past_due' ? 'Update payment' : 'Subscribe'}</button>
                <div>
                  <label className="block text-xs text-muted-foreground" htmlFor="app-listing-claim">Bought on paperweighthq.com? Enter your claim code.</label>
                  <div className="flex gap-2 mt-2">
                    <input id="app-listing-claim" data-testid="input-app-listing-claim" value={claimCode} onChange={(event) => setClaimCode(event.target.value)} placeholder="XXXXX-XXXXX" autoCapitalize="characters" className="input-studio flex-1 min-w-0 rounded-xl px-3.5 py-2.5 text-xs" />
                    <button type="button" data-testid="button-app-listing-claim" onClick={() => redeemClaim.mutate()} disabled={!claimCode.trim() || redeemClaim.isPending} className="ghost-button shrink-0 rounded-lg px-3 py-2 text-xs disabled:opacity-50">Redeem</button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </section>
        <section className="panel rounded-2xl p-5 sm:p-6">
          <div className="flex items-center gap-3 mb-4"><ShieldCheck size={18} className="text-primary" /><h2 className="font-display text-xl font-semibold">Telemetry secret</h2></div>
          <p className={data?.telemetryConfigured ? 'text-primary text-xs' : 'text-xs text-muted-foreground'}>{data?.telemetryConfigured ? 'Configured with PaperweightHQ.' : 'Not configured.'}</p>
          <Field label="Shared secret" value={telemetrySecret} onChange={setTelemetrySecret} placeholder="Paste system.pape secret" />
          <div className="flex gap-2 mt-3">
            <button type="button" data-testid="button-save-telemetry-secret" onClick={() => saveSecret.mutate()} disabled={!telemetrySecret.trim() || saveSecret.isPending} className="ghost-button rounded-lg px-3 py-2 text-xs disabled:opacity-50">Save</button>
            <button type="button" data-testid="button-register-telemetry" onClick={() => registerTelemetry.mutate()} disabled={!data?.slug || registerTelemetry.isPending} className="lime-button rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-50">Register</button>
          </div>
        </section>
        {!allDone && <section className="panel rounded-2xl p-5 sm:p-6">
          <h2 className="font-display text-xl font-semibold">Setup progress</h2>
          <div className="space-y-2 mt-4">{SETUP_STEPS.map(([key, label]) => <div key={key} className="flex items-center gap-2 text-xs"><CheckCircle2 size={14} className={milestones[key] ? 'text-primary' : 'text-muted-foreground'} /><span className={milestones[key] ? 'text-primary' : 'text-muted-foreground'}>{label}</span></div>)}</div>
          {!setup?.signupDismissed && milestones.first_listener && <div className="mt-5 pt-4 border-t border-white/[.08]"><Field label="Product updates email" value={signupEmail} onChange={setSignupEmail} placeholder="you@example.com" /><div className="flex gap-2 mt-3"><button type="button" data-testid="button-dashboard-signup" onClick={() => signup.mutate()} disabled={!signupEmail.trim() || signup.isPending} className="lime-button rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-50">Sign up</button><button type="button" data-testid="button-dashboard-signup-dismiss" onClick={() => dismissSignup.mutate()} className="ghost-button rounded-lg px-3 py-2 text-xs">Dismiss</button></div></div>}
        </section>}
        {tunnelStatus?.lastError && <section className="panel rounded-2xl p-5 sm:p-6 text-xs text-destructive"><Loader2 size={15} className="inline mr-2" />{tunnelStatus.lastError}</section>}
      </aside>
    </div>
  </div>;
}
