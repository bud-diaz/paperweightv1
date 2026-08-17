import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ListMusic, Play, Radio, RefreshCw, Shuffle, Square, X } from 'lucide-react';

import { ViewHeader } from '@/components/primitives';
import * as api from '@/lib/api';
import { cn } from '@/lib/utils';
import type { ModalKey } from '@/types';

type StreamStatus = { nowPlaying: { title: string; artist?: string } | null; mode: 'shuffle' | 'scheduled' };
type QueueItem = { mediaId: number; title?: string };

function RotationSection({ onNotify }: { onNotify: (message: string) => void }) {
  const queryClient = useQueryClient();
  const { data: status } = useQuery<StreamStatus>({ queryKey: ['stream', 'status'], queryFn: () => api.stream.status(), refetchInterval: 5000 });
  const { data: queueData } = useQuery<{ queue: QueueItem[] }>({ queryKey: ['dashboard', 'broadcast', 'queue'], queryFn: () => api.dashboard.broadcast.getQueue(), refetchInterval: 5000 });

  const invalidateStatus = () => queryClient.invalidateQueries({ queryKey: ['stream', 'status'] });
  const invalidateQueue = () => queryClient.invalidateQueries({ queryKey: ['dashboard', 'broadcast', 'queue'] });

  const toggleMode = useMutation({
    mutationFn: () => api.dashboard.broadcast.setMode(status?.mode === 'shuffle' ? 'scheduled' : 'shuffle'),
    onSuccess: () => { invalidateStatus(); onNotify('Rotation mode updated.'); },
  });
  const restart = useMutation({
    mutationFn: () => api.dashboard.broadcast.restart(),
    onSuccess: () => { invalidateStatus(); onNotify('Broadcast restarted.'); },
  });
  const removeFromQueue = useMutation({
    mutationFn: (idx: number) => api.dashboard.broadcast.removeFromQueue(idx),
    onSuccess: () => { invalidateQueue(); onNotify('Removed from broadcast queue.'); },
  });

  const queue = queueData?.queue || [];
  const mode = status?.mode || 'shuffle';

  return (
    <>
      <section className="panel rounded-2xl p-5 sm:p-6">
        <p className="font-mono-ui text-[10px] uppercase tracking-[.2em] text-muted-foreground">Station rotation</p>
        <h2 className="font-display text-xl font-semibold mt-2">{status?.nowPlaying ? status.nowPlaying.title : 'Nothing playing'}</h2>
        {status?.nowPlaying?.artist && <p className="text-xs text-muted-foreground mt-1">{status.nowPlaying.artist}</p>}
        <div className="flex items-center gap-2 mt-5">
          <span className="font-mono-ui text-[10px] uppercase tracking-[.15em] text-primary rounded-full bg-primary/10 px-2.5 py-1">{mode}</span>
        </div>
        <div className="flex gap-2 mt-5">
          <button type="button" data-testid="button-toggle-rotation-mode" onClick={() => toggleMode.mutate()} disabled={toggleMode.isPending} className="ghost-button rounded-lg px-3 py-2 text-xs flex items-center gap-2 disabled:opacity-50"><Shuffle size={13} /> Switch to {mode === 'shuffle' ? 'scheduled' : 'shuffle'}</button>
          <button type="button" data-testid="button-restart-broadcast" onClick={() => restart.mutate()} disabled={restart.isPending} className="ghost-button rounded-lg px-3 py-2 text-xs flex items-center gap-2 disabled:opacity-50"><RefreshCw size={13} /> {restart.isPending ? 'Restarting…' : 'Restart'}</button>
        </div>
      </section>
      <section className="panel rounded-2xl p-5 sm:p-6">
        <div className="flex items-center justify-between"><p className="font-mono-ui text-[10px] uppercase tracking-[.2em] text-muted-foreground">Broadcast queue</p><ListMusic size={16} className="text-primary" /></div>
        <div className="mt-4 space-y-2">
          {queue.length ? queue.map((item, i) => (
            <div key={`${item.mediaId}-${i}`} data-testid={`row-queue-${item.mediaId}`} className="flex items-center gap-2 text-sm py-2 border-b border-white/[.07] last:border-0">
              <span className="flex-1 truncate">{item.title || `Track ${item.mediaId}`}</span>
              <button type="button" aria-label={`Remove ${item.title || 'track'} from queue`} data-testid={`button-remove-queue-${item.mediaId}`} onClick={() => removeFromQueue.mutate(i)} className="text-muted-foreground hover:text-destructive"><X size={14} /></button>
            </div>
          )) : <p className="text-xs text-muted-foreground py-2">Queue is empty — add tracks from the library.</p>}
        </div>
      </section>
    </>
  );
}

export function Broadcast({ onOpen, onNotify, live }: { onOpen: (modal: ModalKey) => void; onNotify: (message: string) => void; live: boolean }) {
  return <div className="animate-enter"><ViewHeader eyebrow="Signal / Broadcast" title="Take it live." description="Go direct to your people. Audio from the room, video from the desk, no detour." action={<button type="button" data-testid="button-go-live" onClick={() => onOpen('live')} className={cn('rounded-xl px-4 py-2.5 text-sm font-semibold flex items-center gap-2', live ? 'bg-destructive text-white' : 'lime-button')}><Radio size={15} /> {live ? 'Manage live show' : 'Go live'}</button>} /><div className="grid lg:grid-cols-[1.2fr_.8fr] gap-6"><section className="panel rounded-2xl p-5 sm:p-7 min-h-[390px] relative overflow-hidden"><div className="relative"><div className="flex items-center gap-2"><span className={cn('h-2 w-2 rounded-full', live ? 'bg-destructive animate-pulse' : 'bg-muted-foreground')} /><span className="font-mono-ui text-[10px] uppercase tracking-[.2em] text-muted-foreground">{live ? 'Live now' : 'Studio ready'}</span></div><h2 className="font-display text-4xl sm:text-5xl font-semibold tracking-[-.06em] mt-7 max-w-md">{live ? 'The room is open.' : 'Your room, when you’re ready.'}</h2><p className="text-sm text-muted-foreground mt-4 max-w-sm">{live ? 'Listeners are in the room. Keep making it feel like they found something.' : 'Broadcast a listening session, a work-in-progress, or the full Sunday night show.'}</p><div className="flex items-end gap-1.5 h-20 mt-10">{Array.from({ length: 42 }, (_, i) => <span key={i} className={cn('w-1.5 rounded-full', live ? 'bg-primary wave-bar' : 'bg-white/10')} style={{ height: `${18 + ((i * 23) % 82)}%`, animationDelay: `${i * -.06}s` }} />)}</div><div className="flex items-center gap-3 mt-8"><button type="button" data-testid="button-broadcast-primary" onClick={() => onOpen('live')} className={cn('rounded-xl px-4 py-2.5 text-sm font-semibold flex items-center gap-2', live ? 'bg-destructive text-white' : 'lime-button')}>{live ? <><Square size={14} fill="currentColor" /> Manage broadcast</> : <><Play size={15} fill="currentColor" /> Start a session</>}</button></div></div></section><div className="space-y-6"><RotationSection onNotify={onNotify} /></div></div></div>;
}
