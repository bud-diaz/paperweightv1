import { useQuery } from '@tanstack/react-query';
import {
  ArrowUpRight, BookOpen, Clock3, CloudUpload, Headphones, ListMusic, LockKeyhole, Pause, Play,
  Share2, Sparkles, Users, Wallet,
} from 'lucide-react';

import { Metric, TrackRow } from '@/components/primitives';
import * as api from '@/lib/api';
import { useStationIdentity } from '@/lib/hooks/useStationIdentity';
import { toDisplayTracks, type LibraryStructure } from '@/lib/library';
import type { ModalKey, ViewKey } from '@/types';

type StreamStatus = {
  isLive: boolean;
  liveActive: boolean;
  nowPlaying: { id: number; title: string; artist?: string; duration?: number } | null;
  listenerCount: number;
};

type HistoryDay = { date: string; unique_listeners: number; total_listen_sec: number; top_media_id: number | null };
type EarningsSummary = { totals?: { monthRevenueCents?: number } };
type ActivityItem = { type: 'tip' | 'unlock' | 'subscription'; title: string; detail: string; occurred_at: string };

function formatCents(cents: number) {
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

const ACTIVITY_ICON = { tip: Wallet, unlock: LockKeyhole, subscription: Users } as const;
const ACTIVITY_STYLE = {
  tip: 'h-8 w-8 rounded-lg flex items-center justify-center text-primary bg-primary/10',
  unlock: 'h-8 w-8 rounded-lg flex items-center justify-center text-foreground bg-muted',
  subscription: 'h-8 w-8 rounded-lg flex items-center justify-center text-foreground bg-muted',
} as const;

export function Overview({ onOpen, onPlay, playing, onNavigate }: { onOpen: (modal: ModalKey) => void; onPlay: () => void; playing: boolean; onNavigate: (view: ViewKey) => void }) {
  const { stationName } = useStationIdentity();
  const { data: status } = useQuery<StreamStatus>({ queryKey: ['stream', 'status'], queryFn: () => api.stream.status(), refetchInterval: 5000 });
  const { data: structure } = useQuery<LibraryStructure>({ queryKey: ['library', 'structure'], queryFn: () => api.library.structure() });
  const { data: history } = useQuery<HistoryDay[]>({ queryKey: ['analytics', 'history', 30], queryFn: () => api.dashboard.analytics.history(30) });
  const { data: earnings } = useQuery<EarningsSummary>({ queryKey: ['dashboard', 'earnings'], queryFn: () => api.dashboard.earnings() });
  const { data: recentActivity } = useQuery<ActivityItem[]>({ queryKey: ['analytics', 'activity', 3], queryFn: () => api.dashboard.analytics.activity(3) });

  const displayTracks = toDisplayTracks(structure);
  const catalogCount = displayTracks.length;
  const nowPlaying = status?.nowPlaying;
  const live = !!status?.liveActive;
  const signalLabel = live ? 'Live now' : nowPlaying ? 'Playing now' : 'Station idle';

  const listeningHours = (history || []).reduce((sum, day) => sum + (day.total_listen_sec || 0), 0) / 3600;
  const monthRevenueCents = earnings?.totals?.monthRevenueCents ?? 0;
  const weekHistory = (history || []).slice(-14);
  const weekMax = Math.max(1, ...weekHistory.map((day) => day.unique_listeners || 0));
  const weekLabel = (day?: HistoryDay) => day ? new Date(day.date).toLocaleDateString(undefined, { month: 'short', day: '2-digit' }) : '';

  return (
    <div className="animate-enter">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-5 mb-8">
        <div><p className="font-mono-ui text-[10px] uppercase tracking-[.25em] text-primary mb-3">{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p><h1 className="font-display text-4xl sm:text-5xl font-semibold tracking-[-.06em]">Good evening.</h1><p className="text-muted-foreground mt-3 max-w-md">Your signal is clear. Here’s what moved while you were making things.</p></div>
        <div className="flex items-center gap-2"><button type="button" data-testid="button-open-library" onClick={() => onOpen('library')} className="ghost-button rounded-xl px-4 py-2.5 text-sm flex items-center gap-2"><BookOpen size={16} /> Library</button><button type="button" data-testid="button-upload-audio" onClick={() => onOpen('upload')} className="lime-button rounded-xl px-4 py-2.5 text-sm font-semibold flex items-center gap-2"><CloudUpload size={16} /> Upload</button></div>
      </div>
      <div className="panel rounded-3xl p-5 sm:p-7 relative overflow-hidden mb-6">
        <div className="relative flex flex-col lg:flex-row lg:items-center justify-between gap-7">
          <div className="flex gap-4 items-center"><button type="button" data-testid="button-toggle-station" aria-label={playing ? 'Pause station signal' : 'Play station signal'} onClick={onPlay} className="h-16 w-16 rounded-2xl lime-button flex items-center justify-center">{playing ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" />}</button><div><div className="flex items-center gap-2 mb-1"><span className={`h-1.5 w-1.5 rounded-full bg-primary ${live || nowPlaying ? 'animate-pulse' : ''}`} /><span className="font-mono-ui text-[10px] uppercase tracking-[.16em] text-primary">{signalLabel}</span></div><h2 className="font-display text-xl font-semibold">{stationName} — Radio</h2><p className="text-sm text-muted-foreground">A private signal for your people</p></div></div>
          <div className="flex-1 max-w-sm"><div className="flex items-end gap-[3px] h-10" aria-label="Audio signal waveform">{Array.from({ length: 34 }, (_, index) => (<span key={index} className="wave-bar block w-[3px] rounded-full bg-primary" style={{ height: `${25 + ((index * 17) % 73)}%` }} />))}</div><div className="flex justify-between font-mono-ui text-[10px] text-muted-foreground mt-2"><span>{status?.listenerCount ?? 0} listening</span><span>{nowPlaying ? nowPlaying.title : 'Nothing queued'}</span></div></div>
          <div className="flex items-center gap-2"><button type="button" data-testid="button-open-queue" onClick={() => onOpen('library')} className="ghost-button rounded-xl px-3 py-2 text-xs flex gap-2 items-center"><ListMusic size={14} /> Catalog <span className="text-primary">{String(catalogCount).padStart(2, '0')}</span></button><button type="button" aria-label="Share station signal" data-testid="button-share-station-signal" onClick={() => onOpen('share')} className="h-9 w-9 rounded-lg inline-flex items-center justify-center ghost-button"><Share2 size={15} /></button></div>
        </div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Metric label="Listeners now" value={String(status?.listenerCount ?? 0)} change={live ? 'Live broadcast active' : 'Automated rotation'} icon={Headphones} />
        <Metric label="Catalog size" value={String(catalogCount)} change={`${structure?.projects.length ?? 0} collections`} icon={Users} accent="neutral" />
        <Metric label="Listening hours" value={`${listeningHours.toFixed(1)}h`} change="Last 30 days" icon={Clock3} accent="neutral" />
        <Metric label="This month" value={formatCents(monthRevenueCents)} change="Unlocks + tips" icon={Wallet} />
      </div>
      <div className="grid lg:grid-cols-[1.12fr_.88fr] gap-6">
        <section className="panel rounded-2xl p-5 sm:p-6"><div className="flex items-center justify-between mb-5"><div><p className="font-mono-ui text-[10px] uppercase tracking-[.2em] text-muted-foreground">Your catalog</p><h2 className="font-display text-xl font-semibold mt-1">Keep the signal moving</h2></div><button type="button" data-testid="button-view-releases" onClick={() => onNavigate('releases')} className="text-xs text-primary flex gap-1 items-center">View releases <ArrowUpRight size={14} /></button></div><div className="space-y-0">{displayTracks.length ? displayTracks.slice(0, 3).map((track, i) => <TrackRow key={track.id} track={track} index={i} playing={playing && i === 0} onPlay={onPlay} />) : <p className="text-sm text-muted-foreground py-6 text-center">Nothing in the vault yet — upload something to get started.</p>}</div></section>
        <section className="panel rounded-2xl p-5 sm:p-6"><div className="flex items-center justify-between mb-5"><div><p className="font-mono-ui text-[10px] uppercase tracking-[.2em] text-muted-foreground">Pulse check</p><h2 className="font-display text-xl font-semibold mt-1">Audience, this week</h2></div><button type="button" data-testid="button-view-analytics" onClick={() => onNavigate('analytics')} className="ghost-button rounded-lg px-2.5 py-1.5 text-xs">Details</button></div>{weekHistory.length ? <><div className="h-28 flex items-end gap-2 mb-3">{weekHistory.map((day) => <div key={day.date} className="flex-1 rounded-t-sm bg-primary/70 hover:bg-primary transition-colors" style={{ height: `${Math.max(8, Math.round(((day.unique_listeners || 0) / weekMax) * 100))}%` }} />)}</div><div className="flex justify-between text-[10px] font-mono-ui text-muted-foreground"><span>{weekLabel(weekHistory[0])}</span><span>{weekLabel(weekHistory[Math.floor(weekHistory.length / 2)])}</span><span>{weekLabel(weekHistory[weekHistory.length - 1])}</span></div></> : <p className="text-sm text-muted-foreground py-6 text-center">No listening activity yet.</p>}</section>
      </div>
      <div className="grid lg:grid-cols-[.88fr_1.12fr] gap-6 mt-6">
        <section className="panel rounded-2xl p-5 sm:p-6"><div className="flex justify-between items-center mb-5"><h2 className="font-display text-xl font-semibold">Recent activity</h2><button type="button" data-testid="button-view-activity" onClick={() => onNavigate('activity')} className="text-xs text-primary">See all</button></div><div className="space-y-4">{recentActivity?.length ? recentActivity.map((item, i) => { const Icon = ACTIVITY_ICON[item.type]; return <div key={`${item.type}-${item.occurred_at}-${i}`} className="flex gap-3 items-start"><span className={ACTIVITY_STYLE[item.type]}><Icon size={15} /></span><div><p className="text-sm leading-snug">{item.title}</p><p className="text-[11px] text-muted-foreground mt-1">{item.detail}</p></div></div>; }) : <p className="text-sm text-muted-foreground py-6 text-center">Nothing to show yet.</p>}</div></section>
        <section className="panel rounded-2xl p-5 sm:p-6 relative overflow-hidden"><div className="absolute -right-16 -bottom-24 h-64 w-64 rounded-full border border-primary/10" /><div className="flex items-start justify-between relative"><div><p className="font-mono-ui text-[10px] uppercase tracking-[.2em] text-primary">Next up</p><h2 className="font-display text-2xl font-semibold mt-2">Give the demo room to breathe.</h2><p className="text-sm text-muted-foreground mt-2 max-w-md">Share an early cut with your closest listeners before the weekend.</p></div><Sparkles className="text-primary shrink-0" size={22} /></div><button type="button" data-testid="button-open-vault" onClick={() => onNavigate('vault')} className="lime-button rounded-xl px-4 py-2.5 text-sm font-semibold mt-6 relative">Open the vault</button></section>
      </div>
    </div>
  );
}
