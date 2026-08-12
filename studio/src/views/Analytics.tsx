import { useQuery } from '@tanstack/react-query';
import { CirclePlay, Download, Headphones, TrendingUp, Users } from 'lucide-react';

import { Metric, ViewHeader } from '@/components/primitives';
import * as api from '@/lib/api';
import { formatDuration } from '@/lib/library';

type LiveStats = { currentListeners: number; peakToday: number };
type HistoryRow = { date: string; unique_listeners: number; total_listen_sec: number };
type TopTrack = { id: number; title: string; filename: string; artist: string | null; play_count: number; total_seconds: number };
type SubscriberStats = { activeTotal: number; rows: { date: string; new_subscribers: number }[] };

export function Analytics({ onNotify }: { onNotify: (message: string) => void }) {
  const { data: live } = useQuery<LiveStats>({ queryKey: ['dashboard', 'analytics', 'live'], queryFn: () => api.dashboard.analytics.live(), refetchInterval: 10000 });
  const { data: history } = useQuery<HistoryRow[]>({ queryKey: ['dashboard', 'analytics', 'history'], queryFn: () => api.dashboard.analytics.history(30) });
  const { data: top } = useQuery<TopTrack[]>({ queryKey: ['dashboard', 'analytics', 'top'], queryFn: () => api.dashboard.analytics.top(6, '7d') });
  const { data: subscribers } = useQuery<SubscriberStats>({ queryKey: ['dashboard', 'analytics', 'subscribers'], queryFn: () => api.dashboard.analytics.subscribers(30) });

  const days = history || [];
  const maxListeners = Math.max(1, ...days.map((d) => d.unique_listeners));
  const totalListenersRange = days.reduce((sum, d) => sum + d.unique_listeners, 0);
  const newSubscribersInRange = (subscribers?.rows || []).reduce((sum, r) => sum + r.new_subscribers, 0);

  return <div className="animate-enter">
    <ViewHeader eyebrow="Signal / Analytics" title="Know what resonates." description="The useful version of the numbers: where people found you, what they stayed for, and when they come back." action={<button type="button" data-testid="button-export-analytics" onClick={() => onNotify('Analytics export is wired in a later pass.')} className="ghost-button rounded-xl px-4 py-2.5 text-sm flex items-center gap-2"><Download size={15} /> Export report</button>} />
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
      <Metric label="Listening now" value={String(live?.currentListeners ?? 0)} change="Live" icon={Headphones} />
      <Metric label="Peak today" value={String(live?.peakToday ?? 0)} change="Unique listeners" icon={TrendingUp} accent="coral" />
      <Metric label="Active subscribers" value={String(subscribers?.activeTotal ?? 0)} change={`+${newSubscribersInRange} in 30 days`} icon={Users} accent="blue" />
      <Metric label="Listeners, 30 days" value={String(totalListenersRange)} change="Summed daily uniques" icon={CirclePlay} />
    </div>
    <div className="grid lg:grid-cols-[1.3fr_.7fr] gap-6">
      <section className="panel rounded-2xl p-5 sm:p-6">
        <div className="flex items-start justify-between"><div><p className="font-mono-ui text-[10px] uppercase tracking-[.2em] text-muted-foreground">Audience over time</p><h2 className="font-display text-2xl font-semibold mt-1">Last 30 days</h2></div></div>
        {days.length ? <>
          <div className="h-52 mt-8 flex items-end gap-[3px] sm:gap-1 border-b border-l border-white/[.1] pl-3 pb-0">{days.map((d, i) => <div key={d.date} className="flex-1 rounded-t-sm bg-gradient-to-t from-[#91a4ff]/20 to-[#a9d647]" style={{ height: `${Math.max(2, (d.unique_listeners / maxListeners) * 100)}%`, opacity: .52 + (i / (days.length * 2)) }} title={`${d.date}: ${d.unique_listeners}`} />)}</div>
          <div className="flex justify-between text-[10px] font-mono-ui text-muted-foreground pt-3"><span>{days[0]?.date}</span><span>{days[days.length - 1]?.date}</span></div>
        </> : <p className="text-sm text-muted-foreground py-10 text-center">No listening data yet.</p>}
      </section>
      <section className="panel rounded-2xl p-5 sm:p-6">
        <p className="font-mono-ui text-[10px] uppercase tracking-[.2em] text-muted-foreground">Subscriber growth</p>
        <h2 className="font-display text-xl font-semibold mt-1">{subscribers?.activeTotal ?? 0} active</h2>
        <div className="space-y-3 mt-6">
          {(subscribers?.rows || []).filter((r) => r.new_subscribers > 0).slice(-5).map((row) => (
            <div key={row.date}><div className="flex justify-between text-xs mb-1"><span>{row.date}</span><span className="font-mono-ui text-primary">+{row.new_subscribers}</span></div></div>
          ))}
          {!(subscribers?.rows || []).some((r) => r.new_subscribers > 0) && <p className="text-xs text-muted-foreground">No new subscribers in the last 30 days.</p>}
        </div>
      </section>
    </div>
    <section className="panel rounded-2xl p-5 sm:p-6 mt-6">
      <div className="flex items-center justify-between mb-4"><div><p className="font-mono-ui text-[10px] uppercase tracking-[.2em] text-muted-foreground">Catalog performance</p><h2 className="font-display text-xl font-semibold mt-1">Top tracks, last 7 days</h2></div></div>
      {top && top.length ? top.map((track) => (
        <div key={track.id} data-testid={`row-top-track-${track.id}`} className="flex items-center gap-3 py-3 border-b border-white/[.07] last:border-0">
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{track.title || track.filename}</p>{track.artist && <p className="truncate text-xs text-muted-foreground">{track.artist}</p>}</div>
          <span className="font-mono-ui text-[11px] text-muted-foreground">{track.play_count} plays</span>
          <span className="font-mono-ui text-[11px] text-muted-foreground w-14 text-right">{formatDuration(track.total_seconds)}</span>
        </div>
      )) : <p className="text-sm text-muted-foreground py-6 text-center">No plays in the last 7 days.</p>}
    </section>
  </div>;
}
