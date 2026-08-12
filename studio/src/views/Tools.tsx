import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Aperture, ArrowUpRight, CircleHelp, Copy, ListMusic, Share2, Tags, Trash2 } from 'lucide-react';

import { ViewHeader } from '@/components/primitives';
import * as api from '@/lib/api';
import type { ModalKey } from '@/types';

type ShareLink = { token: string; target_type: 'track' | 'project'; target_label: string | null; url: string; expires_at: string | null; created_at: string };

function ShareLinksSection({ onNotify, onOpen }: { onNotify: (message: string) => void; onOpen: (modal: ModalKey) => void }) {
  const queryClient = useQueryClient();
  const { data: links, isLoading } = useQuery<ShareLink[]>({ queryKey: ['dashboard', 'share'], queryFn: () => api.dashboard.share.list() });
  const remove = useMutation({
    mutationFn: (token: string) => api.dashboard.share.remove(token),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['dashboard', 'share'] }); onNotify('Share link removed.'); },
  });

  return (
    <section className="panel rounded-2xl p-5 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <div><h2 className="font-display text-xl font-semibold">Share links</h2><p className="text-xs text-muted-foreground mt-1">Focused links to a single track or collection.</p></div>
        <button type="button" data-testid="button-new-share-link" onClick={() => onOpen('share')} className="ghost-button rounded-lg px-3 py-2 text-xs flex items-center gap-2"><Share2 size={14} /> New link</button>
      </div>
      {isLoading ? <p className="text-xs text-muted-foreground">Loading…</p> : links && links.length ? links.map((link) => (
        <div key={link.token} data-testid={`row-share-link-${link.token}`} className="flex items-center gap-3 py-3 border-b border-white/[.07] last:border-0">
          <div className="min-w-0 flex-1"><p className="text-sm truncate">{link.target_label || `${link.target_type} #${link.token.slice(0, 8)}`}</p><p className="text-xs text-muted-foreground truncate mt-1">{link.url}{link.expires_at ? ` · expires ${new Date(link.expires_at).toLocaleDateString()}` : ''}</p></div>
          <button type="button" aria-label="Copy link" data-testid={`button-copy-share-link-${link.token}`} onClick={() => { navigator.clipboard?.writeText(link.url); onNotify('Link copied.'); }} className="text-muted-foreground hover:text-primary"><Copy size={14} /></button>
          <button type="button" aria-label="Remove link" data-testid={`button-remove-share-link-${link.token}`} onClick={() => remove.mutate(link.token)} className="text-muted-foreground hover:text-destructive"><Trash2 size={14} /></button>
        </div>
      )) : <p className="text-sm text-muted-foreground py-4 text-center">No share links yet.</p>}
    </section>
  );
}

export function Tools({ onNotify, onOpen }: { onNotify: (message: string) => void; onOpen: (modal: ModalKey) => void }) {
  const tools = [
    { icon: ListMusic, title: 'Smart playlists', body: 'Auto-sort your catalog by mood, play count, or release date. Desktop app only.', action: 'Build playlist' },
    { icon: Aperture, title: 'Preview scheduler', body: 'Give subscribers a first listen before the public release.', action: 'Schedule a preview' },
    { icon: Tags, title: 'Release notes', body: 'Add context, credits, and the story behind each drop.', action: 'Write release notes' },
  ];
  return <div className="animate-enter">
    <ViewHeader eyebrow="Identity / Tools" title="Small tools, sharp edges." description="The pieces that make publishing feel less like paperwork and more like a practice." />
    <ShareLinksSection onNotify={onNotify} onOpen={onOpen} />
    <div className="grid md:grid-cols-2 gap-4 mt-6">
      {tools.map((tool, i) => {
        const Icon = tool.icon;
        return <section className="panel rounded-2xl p-5 sm:p-6 flex flex-col min-h-52" key={tool.title}>
          <span className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center"><Icon size={18} /></span>
          <h2 className="font-display text-xl font-semibold mt-5">{tool.title}</h2>
          <p className="text-sm text-muted-foreground mt-2 max-w-sm">{tool.body}</p>
          <button type="button" data-testid={`button-tool-${i}`} onClick={() => i === 1 ? onOpen('live') : onNotify(`${tool.title} is wired in a later pass.`)} className="text-xs text-primary mt-auto pt-6 flex items-center gap-1">{tool.action} <ArrowUpRight size={14} /></button>
        </section>;
      })}
    </div>
    <section className="panel rounded-2xl p-5 sm:p-6 mt-6"><div className="flex items-start gap-3"><CircleHelp size={18} className="text-accent" /><div><h2 className="font-display text-lg font-semibold">Need a hand with the release?</h2><p className="text-sm text-muted-foreground mt-1">Read the short guide to making your next drop feel like an event.</p><button type="button" data-testid="button-read-release-guide" onClick={() => onNotify('Release guide is wired in a later pass.')} className="text-xs text-primary mt-4">Read the guide <ArrowUpRight size={13} className="inline ml-1" /></button></div></div></section>
  </div>;
}
