import { useQuery } from '@tanstack/react-query';
import { Globe2, MessageSquareText, Pencil, Send, Trash2, Users } from 'lucide-react';

import { Avatar, IconButton, ViewHeader } from '@/components/primitives';
import { useStationIdentity } from '@/lib/hooks/useStationIdentity';
import * as api from '@/lib/api';
import type { CreatorPost, ModalKey } from '@/types';

function formatPublishedAt(iso: string) {
  try {
    const normalized = iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`;
    const date = new Date(normalized);
    return date > new Date() ? `Scheduled · ${date.toLocaleString()}` : date.toLocaleString();
  } catch {
    return iso;
  }
}

export function ActivityView({ onOpen, onEditPost, onDeletePost }: { onOpen: (modal: ModalKey) => void; onEditPost: (post: CreatorPost) => void; onDeletePost: (post: CreatorPost) => void }) {
  const { stationName } = useStationIdentity();
  const { data: posts, isLoading } = useQuery<CreatorPost[]>({ queryKey: ['dashboard', 'posts'], queryFn: () => api.dashboard.posts.list() });

  return <div className="animate-enter"><ViewHeader eyebrow="Studio / Activity" title="Everything in motion." description="A running log of the notes you've published for your listeners." action={<button type="button" data-testid="button-post-update" onClick={() => onOpen('posts')} className="lime-button rounded-xl px-4 py-2.5 text-sm font-semibold flex items-center gap-2"><Send size={15} /> Post an update</button>} />
    <div className="grid lg:grid-cols-[1.15fr_.85fr] gap-6">
      <section className="panel rounded-2xl p-5 sm:p-6">
        <div className="flex justify-between items-center mb-3"><h2 className="font-display text-xl font-semibold">Posts</h2></div>
        {isLoading ? <p className="text-sm text-muted-foreground py-6">Loading…</p> : posts && posts.length ? posts.map((post) => (
          <div key={post.id} data-testid={`row-post-${post.id}`} className="group flex gap-4 py-5 border-b border-white/[.07] last:border-0">
            <span className="h-10 w-10 rounded-xl flex items-center justify-center text-primary bg-primary/10 shrink-0"><MessageSquareText size={17} /></span>
            <div className="flex-1 min-w-0">
              {post.title && <p className="text-sm font-medium">{post.title}</p>}
              <p className="text-sm whitespace-pre-wrap">{post.body}</p>
              <div className="flex items-center gap-3 mt-2 text-[11px] text-muted-foreground">
                <span>{formatPublishedAt(post.published_at)}</span>
                <span className="flex items-center gap-1">{post.visibility === 'public' ? <><Globe2 size={11} /> Public</> : <><Users size={11} /> Supporters</>}</span>
              </div>
            </div>
            <div className="flex items-start gap-1 opacity-60 group-hover:opacity-100 shrink-0">
              <IconButton label={`Edit post ${post.id}`} onClick={() => onEditPost(post)}><Pencil size={14} /></IconButton>
              <IconButton label={`Delete post ${post.id}`} onClick={() => onDeletePost(post)}><Trash2 size={14} /></IconButton>
            </div>
          </div>
        )) : <div className="py-10 text-center"><p className="text-sm text-muted-foreground">No posts yet.</p><button type="button" data-testid="button-first-post" onClick={() => onOpen('posts')} className="text-xs text-primary mt-2">Write your first update</button></div>}
      </section>
      <div className="space-y-6">
        <section className="panel rounded-2xl p-5 sm:p-6">
          <div className="flex items-center gap-3"><Avatar name={stationName} size="sm" /><div><p className="text-sm font-medium">{stationName}</p><p className="text-[11px] text-muted-foreground">Public profile</p></div><button type="button" data-testid="button-share-profile" onClick={() => onOpen('share')} className="ml-auto text-xs text-primary">Share</button></div>
        </section>
      </div>
    </div>
  </div>;
}
