import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Mail, Megaphone, Radio, Search, Send, Users } from 'lucide-react';

import { Field, ViewHeader } from '@/components/primitives';
import * as api from '@/lib/api';

type Today = { outcomes?: Record<string, number>; insights?: { key: string; eyebrow?: string; title: string; body: string; tone?: string }[] };
type Segment = { key: string; label: string; count: number };
type Person = { profile_id: number; display_name?: string | null; email?: string | null; listen_count?: number; listen_seconds?: number; purchase_cents?: number; active_subscriptions?: number; favorite_title?: string | null; last_listen_at?: string | null; last_seen_at?: string | null };
type Automations = { paused?: boolean; rules?: { id: number; name: string; description: string; trigger: string; enabled: boolean; mode: string; marketing?: boolean }[]; runs?: { id: number; display_name?: string; template_key?: string; explanation?: string; status: string; last_error?: string | null }[] };
type Poll = { id: number; question: string; status: string; options?: { label: string; votes: number }[] };
type Request = { id: number; media_title: string; listener_name?: string; dedication?: string | null; status: string };

function money(cents?: number) {
  return `$${((Number(cents) || 0) / 100).toFixed(2)}`;
}

function when(value?: string | null) {
  if (!value) return 'never';
  const date = new Date(String(value).includes('T') ? value : `${String(value).replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

export function AudienceView({ onNotify }: { onNotify: (message: string) => void }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [segment, setSegment] = useState('');
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState('');
  const [externalPlatform, setExternalPlatform] = useState('youtube');
  const [externalQuery, setExternalQuery] = useState('');
  const { data: today } = useQuery<Today>({ queryKey: ['dashboard', 'today'], queryFn: () => api.dashboard.today.get() });
  const { data: segments } = useQuery<{ segments: Segment[] }>({ queryKey: ['dashboard', 'audience', 'segments'], queryFn: () => api.dashboard.audienceMemory.segments() });
  const { data: people } = useQuery<{ people: Person[] }>({ queryKey: ['dashboard', 'audience', 'people', search, segment], queryFn: () => segment ? api.dashboard.audienceMemory.segment(segment) : api.dashboard.audienceMemory.people(search) });
  const { data: automations } = useQuery<Automations>({ queryKey: ['dashboard', 'automations'], queryFn: () => api.dashboard.automations.get() });
  const { data: polls } = useQuery<{ polls: Poll[] }>({ queryKey: ['dashboard', 'participation', 'polls'], queryFn: () => api.dashboard.participation.polls() });
  const { data: requests } = useQuery<{ requests: Request[] }>({ queryKey: ['dashboard', 'participation', 'requests'], queryFn: () => api.dashboard.participation.requests() });
  const { data: creatorType } = useQuery<{ creatorType?: string; stationIdentity?: string }>({ queryKey: ['dashboard', 'creator-type'], queryFn: () => api.dashboard.creatorType() });
  const { data: radioHost } = useQuery<{ radioHost: boolean; locked: boolean; switches: number }>({ queryKey: ['dashboard', 'radio-host'], queryFn: () => api.dashboard.radioHostStatus() });
  const { data: externalResults, refetch: runExternalSearch, isFetching: searchingExternal } = useQuery<{ items?: { title: string; artist?: string; platform: string; externalUrl?: string; duration?: number }[] }>({ queryKey: ['dashboard', 'external-search', externalPlatform, externalQuery], queryFn: () => api.dashboard.externalSearch(externalPlatform, externalQuery), enabled: false });

  const invalidate = (key: unknown[]) => queryClient.invalidateQueries({ queryKey: key });
  const toggleRadioHost = useMutation({ mutationFn: () => api.dashboard.toggleRadioHost(), onSuccess: (result: { error?: string; radioHost?: boolean }) => { if (result.error) onNotify(result.error); else { invalidate(['dashboard', 'radio-host']); invalidate(['dashboard', 'creator-type']); onNotify(result.radioHost ? 'Radio host mode on.' : 'Radio host mode off.'); } } });
  const pauseAutomations = useMutation({ mutationFn: (paused: boolean) => api.dashboard.automations.pause(paused), onSuccess: () => { invalidate(['dashboard', 'automations']); onNotify('Automation state updated.'); } });
  const updateRule = useMutation({ mutationFn: ({ id, body }: { id: number; body: object }) => api.dashboard.automations.updateRule(id, body), onSuccess: () => invalidate(['dashboard', 'automations']) });
  const sendRun = useMutation({ mutationFn: (id: number) => api.dashboard.automations.send(id), onSuccess: () => { invalidate(['dashboard', 'automations']); onNotify('Automation delivery queued.'); } });
  const sweep = useMutation({ mutationFn: () => api.dashboard.automations.sweep(), onSuccess: ({ data }: { data: { created?: number } }) => { invalidate(['dashboard', 'automations']); onNotify(`${data.created || 0} recommendations created.`); } });
  const createPoll = useMutation({
    mutationFn: () => api.dashboard.participation.createPoll({ question: pollQuestion.trim(), options: pollOptions.split(',').map((option) => option.trim()).filter(Boolean) }),
    onSuccess: ({ res, data }: { res: Response; data: { error?: string } }) => {
      if (!res.ok) { onNotify(data.error || 'Could not create poll.'); return; }
      setPollQuestion('');
      setPollOptions('');
      invalidate(['dashboard', 'participation', 'polls']);
      onNotify('Poll created.');
    },
  });
  const setPollStatus = useMutation({ mutationFn: ({ id, status }: { id: number; status: string }) => api.dashboard.participation.setPollStatus(id, status), onSuccess: () => invalidate(['dashboard', 'participation', 'polls']) });
  const updateRequest = useMutation({ mutationFn: ({ id, status }: { id: number; status: string }) => api.dashboard.participation.updateRequest(id, status), onSuccess: () => { invalidate(['dashboard', 'participation', 'requests']); onNotify('Request updated.'); } });
  const importExternal = useMutation({ mutationFn: (item: { title: string; artist?: string; platform: string; externalUrl?: string; duration?: number }) => api.dashboard.media.importExternal(item), onSuccess: ({ res, data }: { res: Response; data: { error?: string } }) => { if (!res.ok) onNotify(data.error || 'Import failed.'); else onNotify('External track imported.'); } });

  return <div className="animate-enter">
    <ViewHeader eyebrow="Studio / Audience" title="Work the listener relationship." description="Audience memory, automations, participation, radio-host mode, and station search imports." />
    <div className="grid xl:grid-cols-[1fr_420px] gap-6">
      <div className="space-y-6">
        <section className="panel rounded-2xl p-5 sm:p-6">
          <div className="flex items-center gap-3 mb-5"><Users size={18} className="text-primary" /><h2 className="font-display text-xl font-semibold">Today</h2></div>
          <div className="grid sm:grid-cols-4 gap-3">{Object.entries(today?.outcomes || {}).map(([key, value]) => <div key={key} className="panel-subtle rounded-xl p-4"><p className="font-display text-2xl font-semibold">{value}</p><p className="text-[10px] uppercase text-muted-foreground mt-1">{key.replace(/[A-Z]/g, ' $&')}</p></div>)}</div>
          <div className="space-y-3 mt-5">{today?.insights?.length ? today.insights.map((insight) => <div key={insight.key} className="panel-subtle rounded-xl p-4"><p className="font-mono-ui text-[10px] uppercase tracking-[.2em] text-primary">{insight.eyebrow || insight.tone || 'Insight'}</p><p className="font-medium text-sm mt-2">{insight.title}</p><p className="text-xs text-muted-foreground mt-1">{insight.body}</p></div>) : <p className="text-xs text-muted-foreground">No daily interventions right now.</p>}</div>
        </section>

        <section className="panel rounded-2xl p-5 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5"><div className="flex items-center gap-3"><Mail size={18} className="text-primary" /><h2 className="font-display text-xl font-semibold">Audience memory</h2></div><div className="relative"><Search size={14} className="absolute left-3 top-3 text-muted-foreground" /><input value={search} onChange={(event) => { setSearch(event.target.value); setSegment(''); }} placeholder="Search people" className="input-studio rounded-xl py-2.5 pl-9 pr-3 text-sm" /></div></div>
          <div className="flex gap-2 overflow-x-auto pb-2"><button type="button" onClick={() => setSegment('')} className={`ghost-button rounded-lg px-3 py-2 text-xs ${!segment ? 'text-primary' : ''}`}>All</button>{segments?.segments?.map((item) => <button type="button" key={item.key} onClick={() => setSegment(item.key)} className={`ghost-button rounded-lg px-3 py-2 text-xs whitespace-nowrap ${segment === item.key ? 'text-primary' : ''}`}>{item.label} {item.count}</button>)}</div>
          <div className="grid md:grid-cols-2 gap-3 mt-4">{people?.people?.length ? people.people.map((person) => <div key={person.profile_id} className="panel-subtle rounded-xl p-4"><p className="font-medium text-sm">{person.display_name || person.email || 'Listener'}</p><p className="text-xs text-muted-foreground mt-1">{person.listen_count || 0} sessions · {Math.round((person.listen_seconds || 0) / 60)} minutes · {person.active_subscriptions ? 'Subscriber' : money(person.purchase_cents)}</p><p className="text-[11px] text-muted-foreground mt-2">{person.favorite_title ? `Favorite: ${person.favorite_title} · ` : ''}Last seen {when(person.last_listen_at || person.last_seen_at)}</p></div>) : <p className="text-xs text-muted-foreground">No listeners match this view yet.</p>}</div>
        </section>

        <section className="panel rounded-2xl p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3 mb-5"><div className="flex items-center gap-3"><Bot size={18} className="text-primary" /><h2 className="font-display text-xl font-semibold">Automations</h2></div><button type="button" onClick={() => sweep.mutate()} className="ghost-button rounded-lg px-3 py-2 text-xs">Run sweep</button></div>
          <label className="flex items-center gap-3 text-sm mb-4"><input type="checkbox" checked={!!automations?.paused} onChange={(event) => pauseAutomations.mutate(event.target.checked)} className="accent-primary" /> Pause automations</label>
          <div className="space-y-3">{automations?.rules?.map((rule) => <div key={rule.id} className="panel-subtle rounded-xl p-4"><div className="flex items-start gap-3"><div className="flex-1"><p className="text-sm font-medium">{rule.name}</p><p className="text-xs text-muted-foreground mt-1">{rule.description}</p><p className="text-[11px] text-muted-foreground mt-2">Trigger: {rule.trigger}{rule.marketing ? ' · consent required' : ''}</p></div><label className="text-xs flex items-center gap-2"><input type="checkbox" checked={rule.enabled} onChange={(event) => updateRule.mutate({ id: rule.id, body: { enabled: event.target.checked } })} className="accent-primary" /> On</label><select value={rule.mode} onChange={(event) => updateRule.mutate({ id: rule.id, body: { mode: event.target.value } })} className="input-studio rounded-lg px-2 py-2 text-xs"><option value="draft">Recommend</option><option value="automatic">Automatic</option></select></div></div>)}</div>
          <div className="space-y-3 mt-5">{automations?.runs?.slice(0, 8).map((run) => <div key={run.id} className="panel-subtle rounded-xl p-4 flex items-center gap-3"><div className="flex-1"><p className="text-sm">{run.display_name || run.template_key?.replaceAll('_', ' ') || 'Automation'}</p><p className="text-xs text-muted-foreground mt-1">{run.explanation || run.last_error || run.status}</p></div>{run.status === 'recommended' && <button type="button" onClick={() => sendRun.mutate(run.id)} className="lime-button rounded-lg px-3 py-2 text-xs font-semibold flex items-center gap-2"><Send size={13} /> Send</button>}</div>)}</div>
        </section>
      </div>

      <aside className="space-y-6">
        <section className="panel rounded-2xl p-5 sm:p-6">
          <div className="flex items-center gap-3 mb-4"><Megaphone size={18} className="text-primary" /><h2 className="font-display text-xl font-semibold">Participation</h2></div>
          <Field label="Poll question" value={pollQuestion} onChange={setPollQuestion} placeholder="What should play next?" />
          <Field label="Options" value={pollOptions} onChange={setPollOptions} placeholder="Song A, Song B, Song C" />
          <button type="button" onClick={() => createPoll.mutate()} disabled={!pollQuestion.trim() || createPoll.isPending} className="lime-button rounded-lg px-3 py-2 text-xs font-semibold mt-3 disabled:opacity-50">Create poll</button>
          <div className="space-y-3 mt-5">{polls?.polls?.map((poll) => <div key={poll.id} className="panel-subtle rounded-xl p-4"><p className="text-sm font-medium">{poll.question}</p><p className="text-xs text-muted-foreground mt-1">{poll.options?.map((option) => `${option.label} ${option.votes}`).join(' · ')}</p><button type="button" onClick={() => setPollStatus.mutate({ id: poll.id, status: poll.status === 'open' ? 'closed' : 'open' })} className="ghost-button rounded-lg px-3 py-2 text-xs mt-3">{poll.status === 'open' ? 'Close' : 'Open'}</button></div>)}</div>
          <div className="space-y-3 mt-5">{requests?.requests?.map((request) => <div key={request.id} className="panel-subtle rounded-xl p-4"><p className="text-sm font-medium">{request.media_title}</p><p className="text-xs text-muted-foreground mt-1">{request.listener_name || 'Listener'}{request.dedication ? ` · ${request.dedication}` : ''}</p>{request.status === 'pending' && <div className="flex gap-2 mt-3"><button type="button" onClick={() => updateRequest.mutate({ id: request.id, status: 'accepted' })} className="lime-button rounded-lg px-3 py-2 text-xs font-semibold">Queue</button><button type="button" onClick={() => updateRequest.mutate({ id: request.id, status: 'declined' })} className="ghost-button rounded-lg px-3 py-2 text-xs">Decline</button></div>}</div>)}</div>
        </section>

        <section className="panel rounded-2xl p-5 sm:p-6">
          <div className="flex items-center gap-3 mb-4"><Radio size={18} className="text-primary" /><h2 className="font-display text-xl font-semibold">Radio host</h2></div>
          <p className="text-xs text-muted-foreground">Current type: {creatorType?.creatorType || 'unknown'} · switches {radioHost?.switches ?? 0}/3{radioHost?.locked ? ' · locked' : ''}</p>
          <button type="button" data-testid="button-toggle-radio-host" onClick={() => toggleRadioHost.mutate()} disabled={radioHost?.locked || toggleRadioHost.isPending} className="ghost-button rounded-lg px-3 py-2 text-xs mt-3 disabled:opacity-50">{radioHost?.radioHost ? 'Turn off radio host' : 'Turn on radio host'}</button>
          <div className="pt-5 mt-5 border-t border-white/[.08]">
            <div className="grid grid-cols-[120px_1fr] gap-2">
              <select value={externalPlatform} onChange={(event) => setExternalPlatform(event.target.value)} className="input-studio rounded-xl px-3 py-2.5 text-sm"><option value="youtube">YouTube</option><option value="soundcloud">SoundCloud</option><option value="bandcamp">Bandcamp</option></select>
              <input value={externalQuery} onChange={(event) => setExternalQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && externalQuery.trim()) runExternalSearch(); }} placeholder="Search external catalogs" className="input-studio rounded-xl px-3 py-2.5 text-sm" />
            </div>
            <button type="button" onClick={() => runExternalSearch()} disabled={!externalQuery.trim() || searchingExternal} className="lime-button rounded-lg px-3 py-2 text-xs font-semibold mt-3 disabled:opacity-50">Search</button>
            <div className="space-y-3 mt-4">{externalResults?.items?.map((item, index) => <div key={`${item.platform}-${item.externalUrl || item.title}-${index}`} className="panel-subtle rounded-xl p-4 flex items-center gap-3"><div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{item.title}</p><p className="text-xs text-muted-foreground mt-1 truncate">{item.artist || item.platform}</p></div><button type="button" onClick={() => importExternal.mutate(item)} className="ghost-button rounded-lg px-3 py-2 text-xs">Add</button></div>)}</div>
          </div>
        </section>
      </aside>
    </div>
  </div>;
}
