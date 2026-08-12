import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, ListMusic, Plus, Radio, Trash2 } from 'lucide-react';

import { EmptyState, Field, ViewHeader } from '@/components/primitives';
import * as api from '@/lib/api';

type Block = { id: number; label?: string | null; day_of_week: number | null; start_time: string; end_time: string; category?: string | null; mode?: string; target_type?: string | null; target_id?: number | null };
type Playlist = { id: number; name: string; description?: string | null; category?: string | null; tags_filter?: string | string[] | null; mode?: string };
type PreviewSegment = { startTime?: string; start?: string; endTime?: string; end?: string; block?: { id: number; label?: string | null; mode?: string; category?: string | null; target_type?: string | null; target_id?: number | null }; tracks?: { id: number; title?: string | null; filename?: string | null; duration?: number }[] };

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const CATEGORIES = ['', 'music', 'beats', 'podcasts', 'videos', 'drafts', 'live_sessions'];

function splitTags(raw: string) {
  return raw.split(',').map((tag) => tag.trim()).filter(Boolean);
}

function tagsValue(value: Playlist['tags_filter']) {
  if (Array.isArray(value)) return value.join(', ');
  if (!value) return '';
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.join(', ') : '';
  } catch {
    return String(value);
  }
}

function fmtTime(iso?: string) {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function sourceLabel(block: Pick<Block, 'target_type' | 'target_id' | 'category'>) {
  return block.target_type === 'smart_playlist' ? `smart playlist #${block.target_id}` : block.category || 'any category';
}

function ScheduleForm({ block, playlists, onDone, onNotify }: { block?: Block; playlists: Playlist[]; onDone: () => void; onNotify: (message: string) => void }) {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState(block?.label || '');
  const [day, setDay] = useState(block?.day_of_week == null ? '' : String(block.day_of_week));
  const [start, setStart] = useState(block?.start_time || '');
  const [end, setEnd] = useState(block?.end_time || '');
  const [category, setCategory] = useState(block?.category || '');
  const [mode, setMode] = useState(block?.mode || 'shuffle');
  const [source, setSource] = useState(block?.target_type || '');
  const [targetId, setTargetId] = useState(block?.target_id ? String(block.target_id) : '');

  const body = () => ({
    label: label.trim() || null,
    day_of_week: day !== '' ? parseInt(day, 10) : null,
    start_time: start,
    end_time: end,
    category: category || null,
    mode,
    target_type: source || null,
    target_id: source && targetId ? parseInt(targetId, 10) : null,
  });
  const save = useMutation({
    mutationFn: () => block ? api.dashboard.schedule.updateBlock(block.id, body()) : api.dashboard.schedule.createBlock(body()),
    onSuccess: ({ res, data }: { res: Response; data: { error?: string } }) => {
      if (!res.ok) { onNotify(data.error || 'Could not save schedule block.'); return; }
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'schedule'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'schedule', 'preview'] });
      onNotify(block ? 'Schedule block updated.' : 'Schedule block created.');
      onDone();
    },
    onError: () => onNotify('Could not save schedule block.'),
  });

  return <div className="panel-subtle rounded-xl p-4 space-y-4">
    <Field label="Label" value={label} onChange={setLabel} placeholder="Morning rotation" />
    <div className="grid sm:grid-cols-3 gap-3">
      <label className="text-sm text-muted-foreground">Day<select value={day} onChange={(event) => setDay(event.target.value)} className="input-studio w-full rounded-xl px-3.5 py-3 mt-2"><option value="">Daily</option>{DAYS.map((name, index) => <option key={name} value={index}>{name}</option>)}</select></label>
      <label className="text-sm text-muted-foreground">Start<input type="time" value={start} onChange={(event) => setStart(event.target.value)} className="input-studio w-full rounded-xl px-3.5 py-3 mt-2" /></label>
      <label className="text-sm text-muted-foreground">End<input type="time" value={end} onChange={(event) => setEnd(event.target.value)} className="input-studio w-full rounded-xl px-3.5 py-3 mt-2" /></label>
    </div>
    <div className="grid sm:grid-cols-4 gap-3">
      <label className="text-sm text-muted-foreground">Category<select value={category} onChange={(event) => setCategory(event.target.value)} className="input-studio w-full rounded-xl px-3.5 py-3 mt-2">{CATEGORIES.map((item) => <option key={item || 'any'} value={item}>{item || 'Any'}</option>)}</select></label>
      <label className="text-sm text-muted-foreground">Mode<select value={mode} onChange={(event) => setMode(event.target.value)} className="input-studio w-full rounded-xl px-3.5 py-3 mt-2"><option value="shuffle">Shuffle</option><option value="sequential">Sequential</option></select></label>
      <label className="text-sm text-muted-foreground">Source<select value={source} onChange={(event) => { setSource(event.target.value); if (!event.target.value) setTargetId(''); }} className="input-studio w-full rounded-xl px-3.5 py-3 mt-2"><option value="">Category</option><option value="smart_playlist">Smart playlist</option></select></label>
      <label className="text-sm text-muted-foreground">Target<select value={targetId} onChange={(event) => setTargetId(event.target.value)} disabled={source !== 'smart_playlist'} className="input-studio w-full rounded-xl px-3.5 py-3 mt-2 disabled:opacity-50"><option value="">Choose...</option>{playlists.map((playlist) => <option key={playlist.id} value={playlist.id}>{playlist.name}</option>)}</select></label>
    </div>
    <div className="flex justify-end gap-2">
      <button type="button" onClick={onDone} className="ghost-button rounded-lg px-3 py-2 text-xs">Cancel</button>
      <button type="button" data-testid={block ? `button-save-schedule-${block.id}` : 'button-create-schedule'} onClick={() => save.mutate()} disabled={!start || !end || save.isPending} className="lime-button rounded-lg px-4 py-2 text-xs font-semibold disabled:opacity-50">{save.isPending ? 'Saving...' : 'Save block'}</button>
    </div>
  </div>;
}

function PlaylistForm({ playlist, onDone, onNotify }: { playlist?: Playlist; onDone: () => void; onNotify: (message: string) => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(playlist?.name || '');
  const [description, setDescription] = useState(playlist?.description || '');
  const [category, setCategory] = useState(playlist?.category || '');
  const [mode, setMode] = useState(playlist?.mode || 'shuffle');
  const [tags, setTags] = useState(tagsValue(playlist?.tags_filter));
  const body = () => ({ name: name.trim(), description: description.trim() || null, category: category || null, tags_filter: splitTags(tags), mode });
  const save = useMutation({
    mutationFn: () => playlist ? api.dashboard.schedule.smartPlaylists.update(playlist.id, body()) : api.dashboard.schedule.smartPlaylists.create(body()),
    onSuccess: ({ res, data }: { res: Response; data: { error?: string } }) => {
      if (!res.ok) { onNotify(data.error || 'Could not save smart playlist.'); return; }
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'smart-playlists'] });
      onNotify(playlist ? 'Smart playlist updated.' : 'Smart playlist created.');
      onDone();
    },
    onError: () => onNotify('Could not save smart playlist.'),
  });
  return <div className="panel-subtle rounded-xl p-4 space-y-4">
    <div className="grid sm:grid-cols-2 gap-3"><Field label="Name" value={name} onChange={setName} placeholder="Late night requests" /><Field label="Description" value={description} onChange={setDescription} placeholder="Optional note" /></div>
    <div className="grid sm:grid-cols-3 gap-3">
      <label className="text-sm text-muted-foreground">Category<select value={category} onChange={(event) => setCategory(event.target.value)} className="input-studio w-full rounded-xl px-3.5 py-3 mt-2">{CATEGORIES.map((item) => <option key={item || 'any'} value={item}>{item || 'Any'}</option>)}</select></label>
      <label className="text-sm text-muted-foreground">Mode<select value={mode} onChange={(event) => setMode(event.target.value)} className="input-studio w-full rounded-xl px-3.5 py-3 mt-2"><option value="shuffle">Shuffle</option><option value="sequential">Sequential</option></select></label>
      <Field label="Tags" value={tags} onChange={setTags} placeholder="live, request, ambient" />
    </div>
    <div className="flex justify-end gap-2"><button type="button" onClick={onDone} className="ghost-button rounded-lg px-3 py-2 text-xs">Cancel</button><button type="button" onClick={() => save.mutate()} disabled={!name.trim() || save.isPending} className="lime-button rounded-lg px-4 py-2 text-xs font-semibold disabled:opacity-50">Save playlist</button></div>
  </div>;
}

export function ScheduleView({ onNotify }: { onNotify: (message: string) => void }) {
  const queryClient = useQueryClient();
  const { data: blocks = [], isLoading } = useQuery<Block[]>({ queryKey: ['dashboard', 'schedule'], queryFn: () => api.dashboard.schedule.list() });
  const { data: playlists = [] } = useQuery<Playlist[]>({ queryKey: ['dashboard', 'smart-playlists'], queryFn: () => api.dashboard.schedule.smartPlaylists.list() });
  const { data: preview } = useQuery<{ segments: PreviewSegment[] }>({ queryKey: ['dashboard', 'schedule', 'preview'], queryFn: () => api.dashboard.schedule.preview(new Date().toISOString(), 24) });
  const [addingBlock, setAddingBlock] = useState(false);
  const [editingBlock, setEditingBlock] = useState<number | null>(null);
  const [addingPlaylist, setAddingPlaylist] = useState(false);
  const [editingPlaylist, setEditingPlaylist] = useState<number | null>(null);

  const deleteBlock = useMutation({ mutationFn: (id: number) => api.dashboard.schedule.deleteBlock(id), onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['dashboard', 'schedule'] }); onNotify('Schedule block deleted.'); } });
  const deletePlaylist = useMutation({ mutationFn: (id: number) => api.dashboard.schedule.smartPlaylists.remove(id), onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['dashboard', 'smart-playlists'] }); onNotify('Smart playlist deleted.'); } });
  const setMode = useMutation({ mutationFn: (mode: string) => api.dashboard.broadcast.setMode(mode), onSuccess: () => onNotify('Broadcast mode updated.') });

  return <div className="animate-enter">
    <ViewHeader eyebrow="Studio / Schedule" title="Shape the broadcast day." description="Dayparting blocks and smart playlists drive scheduled station playback." action={<button type="button" data-testid="button-enable-scheduled-mode" onClick={() => setMode.mutate('scheduled')} className="ghost-button rounded-xl px-4 py-2.5 text-sm flex items-center gap-2"><Radio size={15} /> Enable scheduled mode</button>} />
    <div className="grid xl:grid-cols-[1fr_420px] gap-6">
      <div className="space-y-6">
        <section className="panel rounded-2xl p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3 mb-5"><div className="flex items-center gap-3"><CalendarClock size={18} className="text-primary" /><h2 className="font-display text-xl font-semibold">Schedule blocks</h2></div><button type="button" data-testid="button-add-schedule-block" onClick={() => setAddingBlock(true)} className="lime-button rounded-lg px-3 py-2 text-xs font-semibold flex items-center gap-2"><Plus size={14} /> Block</button></div>
          {addingBlock && <ScheduleForm playlists={playlists} onDone={() => setAddingBlock(false)} onNotify={onNotify} />}
          {isLoading ? <p className="text-xs text-muted-foreground">Loading schedule...</p> : blocks.length ? <div className="space-y-3 mt-4">{blocks.map((block) => <div key={block.id} className="panel-subtle rounded-xl p-4">
            <div className="flex items-start gap-3"><div className="flex-1 min-w-0"><p className="font-medium text-sm truncate">{block.label || `Block #${block.id}`}</p><p className="text-xs text-muted-foreground mt-1">{block.day_of_week == null ? 'Daily' : DAYS[block.day_of_week]} · {block.start_time}-{block.end_time} · {block.mode || 'shuffle'} · {sourceLabel(block)}</p></div><button type="button" onClick={() => setEditingBlock(editingBlock === block.id ? null : block.id)} className="ghost-button rounded-lg px-3 py-2 text-xs">Edit</button><button type="button" onClick={() => deleteBlock.mutate(block.id)} className="ghost-button rounded-lg px-2 py-2 text-xs text-destructive"><Trash2 size={14} /></button></div>
            {editingBlock === block.id && <div className="mt-4"><ScheduleForm block={block} playlists={playlists} onDone={() => setEditingBlock(null)} onNotify={onNotify} /></div>}
          </div>)}</div> : <EmptyState icon={CalendarClock} title="No dayparts yet" body="Create a daily block or a day-specific block for scheduled playback." action="Add block" onClick={() => setAddingBlock(true)} />}
        </section>

        <section className="panel rounded-2xl p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3 mb-5"><div className="flex items-center gap-3"><ListMusic size={18} className="text-primary" /><h2 className="font-display text-xl font-semibold">Smart playlists</h2></div><button type="button" data-testid="button-add-smart-playlist" onClick={() => setAddingPlaylist(true)} className="lime-button rounded-lg px-3 py-2 text-xs font-semibold flex items-center gap-2"><Plus size={14} /> Playlist</button></div>
          {addingPlaylist && <PlaylistForm onDone={() => setAddingPlaylist(false)} onNotify={onNotify} />}
          {playlists.length ? <div className="space-y-3 mt-4">{playlists.map((playlist) => <div key={playlist.id} className="panel-subtle rounded-xl p-4">
            <div className="flex items-start gap-3"><div className="flex-1 min-w-0"><p className="font-medium text-sm truncate">{playlist.name}</p><p className="text-xs text-muted-foreground mt-1">{playlist.category || 'any category'} · {tagsValue(playlist.tags_filter) || 'no tags'} · {playlist.mode || 'shuffle'}</p></div><button type="button" onClick={() => setEditingPlaylist(editingPlaylist === playlist.id ? null : playlist.id)} className="ghost-button rounded-lg px-3 py-2 text-xs">Edit</button><button type="button" onClick={() => deletePlaylist.mutate(playlist.id)} className="ghost-button rounded-lg px-2 py-2 text-xs text-destructive"><Trash2 size={14} /></button></div>
            {editingPlaylist === playlist.id && <div className="mt-4"><PlaylistForm playlist={playlist} onDone={() => setEditingPlaylist(null)} onNotify={onNotify} /></div>}
          </div>)}</div> : <EmptyState icon={ListMusic} title="No smart playlists" body="Filter your library by category and tags, then assign the playlist to a schedule block." action="Add playlist" onClick={() => setAddingPlaylist(true)} />}
        </section>
      </div>

      <aside className="panel rounded-2xl p-5 sm:p-6 h-fit">
        <h2 className="font-display text-xl font-semibold">Next 24 hours</h2>
        <button type="button" data-testid="button-refresh-schedule-preview" onClick={() => queryClient.invalidateQueries({ queryKey: ['dashboard', 'schedule', 'preview'] })} className="ghost-button rounded-lg px-3 py-2 text-xs mt-3">Refresh preview</button>
        <div className="space-y-3 mt-5">{preview?.segments?.length ? preview.segments.map((segment, index) => <div key={`${segment.startTime || segment.start}-${index}`} className="panel-subtle rounded-xl p-4"><p className="text-sm font-medium">{segment.block?.label || (segment.block ? `Block #${segment.block.id}` : 'Shuffle')}</p><p className="text-xs text-muted-foreground mt-1">{fmtTime(segment.startTime || segment.start)} - {fmtTime(segment.endTime || segment.end)}</p><p className="text-xs text-primary mt-2">{segment.tracks?.length || 0} tracks</p></div>) : <p className="text-xs text-muted-foreground">No preview segments in this range.</p>}</div>
      </aside>
    </div>
  </div>;
}
