import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Bell, DownloadCloud, FolderInput, Palette, Power, RefreshCw, Rss, Settings, Trash2 } from 'lucide-react';

import { Modal, ViewHeader } from '@/components/primitives';
import * as api from '@/lib/api';
import { cn } from '@/lib/utils';

declare global {
  interface Window {
    desktopAPI?: {
      quitApp: () => Promise<unknown>;
      restartServer: () => Promise<unknown>;
      checkForUpdates: () => Promise<{ error?: string; updateAvailable?: boolean; latestVersion?: string }>;
      uninstall: (confirmPhrase: string) => Promise<{ ok?: boolean; error?: string } | undefined>;
      importFolder: () => Promise<{ ok?: boolean; error?: string; imported?: number } | undefined>;
    };
  }
}

type DashboardSettings = {
  notifyWebhookUrl: string;
  notifyLiveEnabled: boolean;
  feedEnabled: boolean;
  feedScope: 'podcasts' | 'all';
  trackGlowColor: string;
  emailConfigured: boolean;
};

type Draft = {
  notifyWebhookUrl: string;
  notifyLiveEnabled: boolean;
  feedEnabled: boolean;
  feedScope: 'podcasts' | 'all';
  trackGlowColor: string;
};

function draftFrom(settings: DashboardSettings | undefined): Draft {
  return {
    notifyWebhookUrl: settings?.notifyWebhookUrl || '',
    notifyLiveEnabled: settings?.notifyLiveEnabled ?? true,
    feedEnabled: settings?.feedEnabled ?? false,
    feedScope: settings?.feedScope || 'podcasts',
    trackGlowColor: settings?.trackGlowColor || '#39ff14',
  };
}

function Toggle({ checked, onChange, testId }: { checked: boolean; onChange: (value: boolean) => void; testId: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} data-testid={testId} onClick={() => onChange(!checked)} className={cn('h-7 w-12 rounded-full p-1 transition-colors shrink-0', checked ? 'bg-primary' : 'bg-white/15')}>
      <span className={cn('block h-5 w-5 rounded-full bg-[#171a28] transition-transform', checked && 'translate-x-5')} />
    </button>
  );
}

function DocsSection() {
  const [selectedDoc, setSelectedDoc] = useState<string | null>(null);
  const { data } = useQuery<{ docs: { id: string; title: string }[] }>({ queryKey: ['docs'], queryFn: () => api.docs.list() });
  const { data: docText, isLoading } = useQuery<string>({ queryKey: ['docs', selectedDoc], queryFn: () => api.docs.get(selectedDoc), enabled: !!selectedDoc });
  const selectedTitle = data?.docs?.find((doc) => doc.id === selectedDoc)?.title || 'Documentation';
  return <section className="panel rounded-2xl p-5 sm:p-6">
    <div className="flex items-center gap-3 mb-5"><BookOpen size={18} className="text-primary" /><h2 className="font-display text-xl font-semibold">Docs</h2></div>
    <div className="grid sm:grid-cols-2 gap-3">{data?.docs?.map((doc) => <button type="button" key={doc.id} data-testid={`button-open-doc-${doc.id}`} onClick={() => setSelectedDoc(doc.id)} className="panel-subtle rounded-xl p-4 text-left hover:bg-white/[.06]"><p className="text-sm font-medium">{doc.title}</p><p className="text-[11px] text-muted-foreground mt-1">{doc.id}</p></button>)}</div>
    {selectedDoc && <Modal title={selectedTitle} eyebrow="Docs" onClose={() => setSelectedDoc(null)} width="max-w-3xl"><pre className="whitespace-pre-wrap text-xs leading-6 text-muted-foreground font-mono-ui">{isLoading ? 'Loading...' : docText}</pre></Modal>}
  </section>;
}

function DesktopSection({ onNotify }: { onNotify: (message: string) => void }) {
  const [confirmingUninstall, setConfirmingUninstall] = useState(false);
  const [phrase, setPhrase] = useState('');
  const desktop = typeof window !== 'undefined' ? window.desktopAPI : undefined;
  if (!desktop) {
    return <section className="panel rounded-2xl p-5 sm:p-6"><div className="flex items-center gap-3 mb-2"><Power size={18} className="text-primary" /><h2 className="font-display text-xl font-semibold">Desktop app</h2></div><p className="text-xs text-muted-foreground">Desktop controls appear when Studio is running inside the Paperweight Electron app.</p></section>;
  }
  const importFolder = async () => {
    const result = await desktop.importFolder();
    if (!result) return;
    if (result.ok === false) onNotify(result.error || 'Folder import failed.');
    else onNotify(`Folder import complete${result.imported != null ? ` · ${result.imported} items` : ''}.`);
  };
  const checkUpdates = async () => {
    const result = await desktop.checkForUpdates();
    if (result?.error) onNotify('Could not check for updates.');
    else if (result?.updateAvailable) onNotify(`Update available: v${result.latestVersion}`);
    else onNotify("You're on the latest version.");
  };
  const uninstall = async () => {
    const result = await desktop.uninstall(phrase);
    if (result?.ok === false) onNotify(result.error || 'Uninstall failed.');
  };
  return <section className="panel rounded-2xl p-5 sm:p-6">
    <div className="flex items-center gap-3 mb-5"><Power size={18} className="text-primary" /><h2 className="font-display text-xl font-semibold">Desktop app</h2></div>
    <div className="grid sm:grid-cols-2 gap-3">
      <button type="button" data-testid="button-desktop-import-folder" onClick={importFolder} className="ghost-button rounded-xl px-3 py-3 text-xs flex items-center justify-center gap-2"><FolderInput size={14} /> Import vault folder</button>
      <button type="button" data-testid="button-desktop-check-updates" onClick={checkUpdates} className="ghost-button rounded-xl px-3 py-3 text-xs flex items-center justify-center gap-2"><DownloadCloud size={14} /> Check for updates</button>
      <button type="button" data-testid="button-desktop-restart-server" onClick={() => { if (window.confirm('Restart Paperweight?')) desktop.restartServer(); }} className="ghost-button rounded-xl px-3 py-3 text-xs flex items-center justify-center gap-2"><RefreshCw size={14} /> Restart server</button>
      <button type="button" data-testid="button-desktop-quit-app" onClick={() => { if (window.confirm('Quit Paperweight?')) desktop.quitApp(); }} className="ghost-button rounded-xl px-3 py-3 text-xs flex items-center justify-center gap-2"><Power size={14} /> Quit app</button>
      <button type="button" data-testid="button-desktop-uninstall-open" onClick={() => setConfirmingUninstall(true)} className="ghost-button rounded-xl px-3 py-3 text-xs text-destructive flex items-center justify-center gap-2 sm:col-span-2"><Trash2 size={14} /> Uninstall</button>
    </div>
    {confirmingUninstall && <Modal title="Confirm uninstall" eyebrow="Desktop app" onClose={() => setConfirmingUninstall(false)}><p className="text-sm text-muted-foreground">Type the station name exactly as prompted by the desktop app to export and uninstall.</p><input value={phrase} onChange={(event) => setPhrase(event.target.value)} data-testid="input-desktop-uninstall-confirm" className="input-studio w-full rounded-xl px-3.5 py-3 text-sm mt-4" /><div className="flex justify-end gap-2 mt-6"><button type="button" onClick={() => setConfirmingUninstall(false)} className="ghost-button rounded-lg px-3 py-2 text-xs">Cancel</button><button type="button" data-testid="button-desktop-uninstall-confirm" onClick={uninstall} disabled={!phrase.trim()} className="rounded-lg px-3 py-2 text-xs font-semibold bg-destructive text-white disabled:opacity-50">Export and uninstall</button></div></Modal>}
  </section>;
}

export function SettingsView({ onNotify }: { onNotify: (message: string) => void }) {
  const [motion, setMotion] = useState(true);
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery<DashboardSettings>({ queryKey: ['dashboard', 'settings'], queryFn: () => api.dashboard.settings.get() });
  const [draft, setDraft] = useState<Draft>(draftFrom(undefined));

  useEffect(() => { if (data) setDraft(draftFrom(data)); }, [data]);

  const save = useMutation({
    mutationFn: (body: Partial<Draft>) => api.dashboard.settings.update(body),
    onSuccess: ({ res, data: result }: { res: Response; data: { error?: string } }) => {
      if (!res.ok) { onNotify(result.error || 'Failed to save.'); return; }
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'settings'] });
      onNotify('Settings saved.');
    },
    onError: () => onNotify('Failed to save settings.'),
  });

  return (
    <div className="animate-enter">
      <ViewHeader eyebrow="Account / Settings" title="Your studio, your rules." description="Quiet preferences that make this workspace feel like yours." />
      <div className="max-w-3xl space-y-4">
        <section className="panel rounded-2xl p-5 sm:p-6">
          <div className="flex items-center gap-3 mb-5"><Settings size={18} className="text-primary" /><h2 className="font-display text-xl font-semibold">Workspace preferences</h2></div>
          <div className="flex items-center gap-4 py-4 border-t border-white/[.08]">
            <div className="flex-1"><p className="text-sm">Motion</p><p className="text-xs text-muted-foreground mt-1">Keep the studio's small movements alive. Stored on this device only.</p></div>
            <Toggle checked={motion} onChange={setMotion} testId="toggle-motion" />
          </div>
        </section>

        <section className="panel rounded-2xl p-5 sm:p-6">
          <div className="flex items-center gap-3 mb-5"><Bell size={18} className="text-primary" /><h2 className="font-display text-xl font-semibold">Notifications</h2></div>
          <div className="flex items-center gap-4 py-4 border-t border-white/[.08]">
            <div className="flex-1"><p className="text-sm">Notify on go-live</p><p className="text-xs text-muted-foreground mt-1">Ping your webhook when you start broadcasting.</p></div>
            <Toggle checked={draft.notifyLiveEnabled} onChange={(value) => setDraft((prev) => ({ ...prev, notifyLiveEnabled: value }))} testId="toggle-notify-live" />
          </div>
          <div className="pt-4 border-t border-white/[.08]">
            <label className="text-sm text-muted-foreground block">Discord-compatible webhook URL
              <input
                data-testid="input-notify-webhook-url"
                value={draft.notifyWebhookUrl}
                onChange={(event) => setDraft((prev) => ({ ...prev, notifyWebhookUrl: event.target.value }))}
                placeholder="https://discord.com/api/webhooks/…"
                className="input-studio w-full rounded-xl px-3.5 py-3 text-sm mt-2"
              />
            </label>
            <p className="text-[11px] text-muted-foreground mt-2">{data?.emailConfigured ? 'Email is also configured — supporters get emailed on new posts.' : 'Email is not configured — only this webhook fires on new posts/go-live.'}</p>
          </div>
          <button type="button" data-testid="button-save-notifications" onClick={() => save.mutate({ notifyWebhookUrl: draft.notifyWebhookUrl, notifyLiveEnabled: draft.notifyLiveEnabled })} disabled={save.isPending || isLoading} className="lime-button rounded-lg px-3 py-2 text-xs font-semibold mt-4 disabled:opacity-50">{save.isPending ? 'Saving…' : 'Save notifications'}</button>
        </section>

        <section className="panel rounded-2xl p-5 sm:p-6">
          <div className="flex items-center gap-3 mb-5"><Rss size={18} className="text-primary" /><h2 className="font-display text-xl font-semibold">RSS / podcast feed</h2></div>
          <div className="flex items-center gap-4 py-4 border-t border-white/[.08]">
            <div className="flex-1"><p className="text-sm">Enable feed.xml</p><p className="text-xs text-muted-foreground mt-1">Publish your catalog as a podcast feed at /feed.xml.</p></div>
            <Toggle checked={draft.feedEnabled} onChange={(value) => setDraft((prev) => ({ ...prev, feedEnabled: value }))} testId="toggle-feed-enabled" />
          </div>
          {draft.feedEnabled && (
            <div className="pt-4 border-t border-white/[.08]">
              <label className="text-sm text-muted-foreground block">Feed scope
                <select
                  data-testid="select-feed-scope"
                  value={draft.feedScope}
                  onChange={(event) => setDraft((prev) => ({ ...prev, feedScope: event.target.value as Draft['feedScope'] }))}
                  className="input-studio w-full rounded-xl px-3.5 py-3 mt-2"
                >
                  <option value="podcasts">Podcast-tagged tracks only</option>
                  <option value="all">Everything public</option>
                </select>
              </label>
            </div>
          )}
          <button type="button" data-testid="button-save-feed" onClick={() => save.mutate({ feedEnabled: draft.feedEnabled, feedScope: draft.feedScope })} disabled={save.isPending || isLoading} className="lime-button rounded-lg px-3 py-2 text-xs font-semibold mt-4 disabled:opacity-50">{save.isPending ? 'Saving…' : 'Save feed settings'}</button>
        </section>

        <section className="panel rounded-2xl p-5 sm:p-6">
          <div className="flex items-center gap-3 mb-5"><Palette size={18} className="text-primary" /><h2 className="font-display text-xl font-semibold">Track glow color</h2></div>
          <div className="flex items-center gap-4">
            <input
              type="color"
              data-testid="input-track-glow-color"
              value={draft.trackGlowColor}
              onChange={(event) => setDraft((prev) => ({ ...prev, trackGlowColor: event.target.value }))}
              className="h-10 w-14 rounded-lg bg-transparent border border-white/[.14] cursor-pointer"
            />
            <p className="text-xs text-muted-foreground flex-1">The accent color for the now-playing indicator on your public player.</p>
            <button type="button" data-testid="button-save-glow-color" onClick={() => save.mutate({ trackGlowColor: draft.trackGlowColor })} disabled={save.isPending || isLoading} className="ghost-button rounded-lg px-3 py-2 text-xs disabled:opacity-50">{save.isPending ? 'Saving…' : 'Save'}</button>
          </div>
        </section>
        <DocsSection />
        <DesktopSection onNotify={onNotify} />
      </div>
    </div>
  );
}
