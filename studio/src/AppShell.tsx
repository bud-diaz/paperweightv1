import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell, ChevronDown, ChevronRight, CloudUpload, Copy, Eye, Globe2,
  Heart, LockKeyhole, LogOut, Menu, Music2, Search, Settings as SettingsIcon,
  Share2, ShieldCheck, Users, X, Check,
} from 'lucide-react';

import {
  Avatar, EmptyState, Field, IconButton, Modal, ModeSwitcher, TrackRow,
} from '@/components/primitives';
import { Logo } from '@/components/Logo';
import { LiveBroadcastModal } from '@/components/LiveBroadcastModal';
import { navGroups } from '@/mock/mockData';
import * as api from '@/lib/api';
import { useDashboardAuth } from '@/lib/auth/DashboardAuthContext';
import { useLiveBroadcast } from '@/lib/hooks/useLiveBroadcast';
import { usePlayerEngine } from '@/lib/hooks/usePlayerEngine';
import { useStationIdentity } from '@/lib/hooks/useStationIdentity';
import type { LibraryStructure } from '@/lib/library';
import { cn } from '@/lib/utils';
import { ActivityView } from '@/views/ActivityView';
import { Analytics } from '@/views/Analytics';
import { AudienceView } from '@/views/AudienceView';
import { Broadcast } from '@/views/Broadcast';
import { Earnings } from '@/views/Earnings';
import { Overview } from '@/views/Overview';
import { PlayerView } from '@/views/PlayerView';
import { ProfileView } from '@/views/ProfileView';
import { Releases } from '@/views/Releases';
import { ScheduleView } from '@/views/ScheduleView';
import { Security } from '@/views/Security';
import { SettingsView } from '@/views/SettingsView';
import { StackView } from '@/views/StackView';
import { Station } from '@/views/Station';
import { Tools } from '@/views/Tools';
import { Vault } from '@/views/Vault';
import type { ModalKey, ModeKey, Track, ViewKey } from '@/types';
import { tracks } from '@/mock/mockData';

export function AppShell() {
  const { logout } = useDashboardAuth();
  const { stationName } = useStationIdentity();
  const [view, setView] = useState<ViewKey>('overview');
  const [mode, setMode] = useState<ModeKey>('studio');
  const [modal, setModal] = useState<ModalKey>(null);
  const [playing, setPlaying] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [queue, setQueue] = useState<Track[]>([tracks[1], tracks[2]]);
  const [toast, setToast] = useState('');
  const [search, setSearch] = useState('');
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadCategory, setUploadCategory] = useState('music');
  const [uploadVisibility, setUploadVisibility] = useState('public');
  const uploadFileInputRef = useRef<HTMLInputElement>(null);
  const [collectionNote, setCollectionNote] = useState('');
  const [shareTargetType, setShareTargetType] = useState<'track' | 'project'>('track');
  const [shareTargetId, setShareTargetId] = useState('');
  const [shareLabel, setShareLabel] = useState('');
  const [shareExpiresHours, setShareExpiresHours] = useState('');
  const [postBody, setPostBody] = useState('');
  const [postVisibility, setPostVisibility] = useState<'public' | 'supporters_only'>('public');
  const filteredTracks = useMemo(() => tracks.filter((track) => `${track.title} ${track.collection}`.toLowerCase().includes(search.toLowerCase())), [search]);
  const queryClient = useQueryClient();
  const { data: shareStructure } = useQuery<LibraryStructure>({ queryKey: ['library', 'structure'], queryFn: () => api.library.structure(), enabled: modal === 'newShareLink' });

  useEffect(() => { if (modal) setMobileMenu(false); }, [modal]);
  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(''), 2800); };
  const liveBroadcast = useLiveBroadcast(notify);
  const playerEngine = usePlayerEngine({ isCreatorSession: true, onNotify: notify });
  const navigate = (next: ViewKey) => { setView(next); setMobileMenu(false); };
  const publishPost = useMutation({
    mutationFn: () => api.dashboard.posts.create({ body: postBody.trim(), visibility: postVisibility }),
    onSuccess: ({ res, data: result }: { res: Response; data: { error?: string } }) => {
      if (!res.ok) { notify(result.error || 'Failed to publish post.'); return; }
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'posts'] });
      setPostBody('');
      notify('Post published to your activity feed.');
      setModal(null);
    },
    onError: () => notify('Failed to publish post.'),
  });
  const uploadMutation = useMutation({
    mutationFn: async () => {
      const formData = new FormData();
      formData.append('media', uploadFile!);
      formData.append('category', uploadCategory);
      formData.append('visibility', uploadVisibility);
      if (uploadTitle.trim()) formData.append('title', uploadTitle.trim());
      const res: Response = await api.dashboard.media.upload(formData);
      const data = await res.json().catch(() => ({}));
      return { res, data };
    },
    onSuccess: ({ res, data }: { res: Response; data: { error?: string; filename?: string; title?: string | null } }) => {
      if (!res.ok) { notify(data.error || 'Upload failed.'); return; }
      queryClient.invalidateQueries({ queryKey: ['library', 'structure'] });
      notify(`${data.title || data.filename} added to your library.`);
      setUploadFile(null);
      setUploadTitle('');
      closeModal();
    },
    onError: () => notify('Upload failed — connection error.'),
  });
  const createCollectionMutation = useMutation({
    mutationFn: () => api.dashboard.vault.createCollection({
      name: uploadTitle.trim(),
      description: collectionNote.trim() || null,
      allow_free: true,
      payment_type: 'one_time',
      suggested_price: 0,
      minimum_price: 0,
    }),
    onSuccess: ({ res, data }: { res: Response; data: { error?: string } }) => {
      if (!res.ok) { notify(data.error || 'Failed to create collection.'); return; }
      queryClient.invalidateQueries({ queryKey: ['library', 'structure'] });
      notify(`${uploadTitle.trim()} created.`);
      setUploadTitle('');
      setCollectionNote('');
      closeModal();
    },
    onError: () => notify('Failed to create collection — connection error.'),
  });
  const resetShareForm = () => { setShareTargetId(''); setShareLabel(''); setShareExpiresHours(''); };
  const createShareLinkMutation = useMutation({
    mutationFn: () => api.dashboard.share.create({
      target_type: shareTargetType,
      target_id: parseInt(shareTargetId, 10),
      label: shareLabel.trim() || undefined,
      expires_in_hours: shareExpiresHours ? parseFloat(shareExpiresHours) : undefined,
    }),
    onSuccess: ({ res, data }: { res: Response; data: { error?: string; url?: string } }) => {
      if (!res.ok) { notify(data.error || 'Failed to create share link.'); return; }
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'share'] });
      if (data.url) navigator.clipboard?.writeText(data.url).catch(() => undefined);
      notify(data.url ? 'Share link created and copied.' : 'Share link created.');
      resetShareForm();
      closeModal();
    },
    onError: () => notify('Failed to create share link — connection error.'),
  });
  const closeModal = () => setModal(null);

  const modalContent = () => {
    if (modal === 'upload') return <Modal title="Bring something into the room." eyebrow="Library / Upload" onClose={closeModal}><input ref={uploadFileInputRef} type="file" accept="audio/*,video/*" data-testid="input-upload-file" className="hidden" onChange={(event) => { const file = event.target.files?.[0] || null; setUploadFile(file); if (file && !uploadTitle.trim()) setUploadTitle(file.name.replace(/\.[^.]+$/, '')); }} /><div onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const file = event.dataTransfer.files?.[0] || null; if (file) { setUploadFile(file); if (!uploadTitle.trim()) setUploadTitle(file.name.replace(/\.[^.]+$/, '')); } }} className="rounded-2xl border border-dashed border-primary/40 bg-primary/[.04] py-9 text-center"><CloudUpload className="mx-auto text-primary" size={26} /><p className="font-display text-lg font-semibold mt-4 px-4 truncate">{uploadFile ? uploadFile.name : 'Drop audio or video here'}</p><p className="text-xs text-muted-foreground mt-2">{uploadFile ? `${(uploadFile.size / (1024 * 1024)).toFixed(1)} MB` : 'WAV, MP3, MOV, or MP4 · up to 2GB'}</p><button type="button" data-testid="button-choose-upload-file" onClick={() => uploadFileInputRef.current?.click()} className="lime-button rounded-lg px-3 py-2 text-xs font-semibold mt-5">{uploadFile ? 'Choose a different file' : 'Choose a file'}</button></div><div className="space-y-4 mt-6"><Field label="Title" value={uploadTitle} onChange={setUploadTitle} placeholder="Name this work" /><div className="grid sm:grid-cols-2 gap-4"><label className="text-sm text-muted-foreground">Category<select value={uploadCategory} onChange={(event) => setUploadCategory(event.target.value)} data-testid="select-upload-category" className="input-studio w-full rounded-xl px-3.5 py-3 mt-2"><option value="music">Music</option><option value="beats">Beats</option><option value="podcasts">Podcasts / interviews</option><option value="videos">Videos</option><option value="drafts">Drafts / demos</option><option value="live_sessions">Live sessions</option></select></label><label className="text-sm text-muted-foreground">Visibility<select value={uploadVisibility} onChange={(event) => setUploadVisibility(event.target.value)} data-testid="select-upload-visibility" className="input-studio w-full rounded-xl px-3.5 py-3 mt-2"><option value="public">Public</option><option value="supporters_only">Supporters only</option><option value="vault">Private vault</option></select></label></div></div><div className="flex justify-end gap-2 mt-7"><button type="button" data-testid="button-cancel-upload" onClick={() => { setUploadFile(null); setUploadTitle(''); closeModal(); }} className="ghost-button rounded-lg px-3 py-2 text-xs">Cancel</button><button type="button" data-testid="button-finish-upload" onClick={() => uploadMutation.mutate()} disabled={!uploadFile || uploadMutation.isPending} className="lime-button rounded-lg px-4 py-2 text-xs font-semibold disabled:opacity-50">{uploadMutation.isPending ? 'Uploading…' : 'Add to library'}</button></div></Modal>;
    if (modal === 'collection') return <Modal title="Give it a shape." eyebrow="Catalog / Collection" onClose={closeModal}><div className="space-y-5"><Field label="Collection name" value={uploadTitle} onChange={setUploadTitle} placeholder="e.g. Songs for the long way home" /><Field label="One-line note" value={collectionNote} onChange={setCollectionNote} placeholder="What should this collection feel like?" /><p className="text-xs text-muted-foreground">Pricing and track order can be set from the collection once it exists.</p></div><div className="flex justify-end gap-2 mt-7"><button type="button" data-testid="button-cancel-collection" onClick={() => { setUploadTitle(''); setCollectionNote(''); closeModal(); }} className="ghost-button rounded-lg px-3 py-2 text-xs">Cancel</button><button type="button" data-testid="button-save-collection" onClick={() => createCollectionMutation.mutate()} disabled={!uploadTitle.trim() || createCollectionMutation.isPending} className="lime-button rounded-lg px-4 py-2 text-xs font-semibold disabled:opacity-50">{createCollectionMutation.isPending ? 'Creating…' : 'Create collection'}</button></div></Modal>;
    if (modal === 'newShareLink') {
      const shareProjects = shareStructure?.projects || [];
      const shareTracks = shareStructure?.standalone || [];
      const options = shareTargetType === 'track' ? shareTracks.map((track) => ({ id: track.id, label: track.title })) : shareProjects.map((project) => ({ id: project.id, label: project.name }));
      return <Modal title="Send them somewhere good." eyebrow="Share / New link" onClose={() => { resetShareForm(); closeModal(); }}><div className="space-y-5">
        <label className="block text-sm text-muted-foreground">What are you sharing?<select value={shareTargetType} onChange={(event) => { setShareTargetType(event.target.value as 'track' | 'project'); setShareTargetId(''); }} data-testid="select-share-target-type" className="input-studio w-full rounded-xl px-3.5 py-3 mt-2"><option value="track">A track</option><option value="project">A collection</option></select></label>
        <label className="block text-sm text-muted-foreground">{shareTargetType === 'track' ? 'Track' : 'Collection'}<select value={shareTargetId} onChange={(event) => setShareTargetId(event.target.value)} data-testid="select-share-target-id" className="input-studio w-full rounded-xl px-3.5 py-3 mt-2"><option value="">Choose one…</option>{options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
        <Field label="Label (optional)" value={shareLabel} onChange={setShareLabel} placeholder="e.g. For the playlist curator" />
        <label className="block text-sm text-muted-foreground">Expires<select value={shareExpiresHours} onChange={(event) => setShareExpiresHours(event.target.value)} data-testid="select-share-expiry" className="input-studio w-full rounded-xl px-3.5 py-3 mt-2"><option value="">Never</option><option value="168">7 days</option><option value="720">30 days</option></select></label>
        {!options.length && <p className="text-xs text-muted-foreground">{shareTargetType === 'track' ? 'No standalone tracks yet — upload one first.' : 'No collections yet — create one from Releases first.'}</p>}
      </div><div className="flex justify-end gap-2 mt-7"><button type="button" data-testid="button-cancel-new-share-link" onClick={() => { resetShareForm(); closeModal(); }} className="ghost-button rounded-lg px-3 py-2 text-xs">Cancel</button><button type="button" data-testid="button-create-share-link" onClick={() => createShareLinkMutation.mutate()} disabled={!shareTargetId || createShareLinkMutation.isPending} className="lime-button rounded-lg px-4 py-2 text-xs font-semibold disabled:opacity-50">{createShareLinkMutation.isPending ? 'Creating…' : 'Create link'}</button></div></Modal>;
    }
    if (modal === 'live') return <LiveBroadcastModal engine={liveBroadcast} onClose={closeModal} onNotify={notify} />;
    if (modal === 'support') {
      const supportOptions: { name: string; body: string; price: string; icon: typeof Heart; }[] = [
        { name: 'Tips', body: 'A one-time note with a little love', price: '$2 · $5 · $10', icon: Heart },
        { name: 'Subscribe', body: 'A monthly seat in the inner room', price: '$5 / month', icon: Users },
        { name: 'All-access', body: 'The complete private archive', price: '$12 / month', icon: LockKeyhole },
      ];
      return <Modal title="Choose your kind of close." eyebrow="Monetize / Support" onClose={closeModal}><p className="text-sm text-muted-foreground -mt-2 mb-6">Let your listeners support the work without turning the room into a checkout.</p><div className="space-y-3">{supportOptions.map((option) => { const Icon = option.icon; return <button type="button" key={option.name} data-testid={`button-configure-${option.name.toLowerCase()}`} onClick={() => { notify(`${option.name} support option selected.`); closeModal(); }} className="w-full panel-subtle p-4 rounded-xl text-left flex items-center gap-4 hover:bg-white/[.07]"><span className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center"><Icon size={18} /></span><span className="flex-1"><p className="text-sm font-medium">{option.name}</p><p className="text-xs text-muted-foreground mt-1">{option.body}</p></span><span className="font-mono-ui text-xs text-primary">{option.price}</span><ChevronRight size={15} className="text-muted-foreground" /></button>; })}</div></Modal>;
    }
    if (modal === 'share') return <Modal title="Send them somewhere good." eyebrow="Share" onClose={closeModal}><div className="panel-subtle rounded-xl p-5"><div className="flex items-center gap-3"><div className="h-12 w-12 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#a9d647,#ff816e)' }}><Music2 size={19} className="text-black" /></div><div><p className="font-medium">{stationName} — Radio</p><p className="text-xs text-muted-foreground mt-1">Your station's public listening link</p></div></div></div>{/* Copy link/share actions are still placeholders — real share links are wired in a later pass (see plan: Releases/Vault -> share links). */}<div className="grid grid-cols-2 gap-3 mt-5"><button type="button" data-testid="button-copy-share-link" onClick={() => { notify('Share link copied.'); closeModal(); }} className="lime-button rounded-xl py-3 text-sm font-semibold flex items-center justify-center gap-2"><Copy size={15} /> Copy link</button><button type="button" data-testid="button-share-social" onClick={() => { notify('Native share sheet opened.'); closeModal(); }} className="ghost-button rounded-xl py-3 text-sm flex items-center justify-center gap-2"><Share2 size={15} /> More options</button></div><div className="mt-6 flex items-center justify-between text-xs text-muted-foreground"><span>Public sharing</span><span className="text-primary flex items-center gap-1"><Globe2 size={13} /> On</span></div></Modal>;
    if (modal === 'library') return <Modal title="Find the next piece." eyebrow="Library / Browse" onClose={closeModal} width="max-w-2xl"><div className="relative"><Search size={16} className="absolute left-3 top-3 text-muted-foreground" /><input autoFocus type="search" value={search} onChange={(event) => setSearch(event.target.value)} data-testid="input-search-library" placeholder="Search tracks, collections, and broadcasts" className="input-studio w-full rounded-xl py-2.5 pl-9 pr-3 text-sm" /></div><div className="flex items-center justify-between mt-6 mb-2"><p className="font-mono-ui text-[10px] uppercase tracking-[.2em] text-muted-foreground">Your library</p><button type="button" data-testid="button-import-external" onClick={() => notify('Paste a SoundCloud, Bandcamp, or Drive link to import.')} className="text-xs text-primary flex gap-1 items-center">Import external</button></div>{filteredTracks.length ? filteredTracks.map((track, i) => <TrackRow key={track.id} track={track} index={i} playing={false} onPlay={() => notify(`${track.title} is now playing.`)} onAdd={() => { setQueue([...queue, track]); notify(`${track.title} added to queue.`); }} />) : <EmptyState icon={Search} title="Nothing in that frequency" body="Try another title or import something from elsewhere." action="Clear search" onClick={() => setSearch('')} />}<div className="mt-5 pt-4 border-t border-white/[.08] flex items-center gap-2"><span className="text-xs text-muted-foreground">{queue.length + 1} tracks in queue</span><button type="button" data-testid="button-clear-queue" onClick={() => { setQueue([]); notify('Queue cleared.'); }} className="ml-auto text-xs text-destructive">Clear queue</button></div></Modal>;
    if (modal === 'posts') return <Modal title="Say something true." eyebrow="Activity / Post" onClose={closeModal}><Field label="Post" value={postBody} onChange={setPostBody} placeholder="A note for the people listening..." multiline /><label className="flex items-center gap-2 mt-5 text-xs text-muted-foreground">Visible to<select data-testid="select-post-visibility" value={postVisibility} onChange={(event) => setPostVisibility(event.target.value as 'public' | 'supporters_only')} className="input-studio rounded-lg px-2 py-1.5 ml-2"><option value="public">Everyone</option><option value="supporters_only">Supporters only</option></select></label><div className="flex justify-end mt-6"><button type="button" data-testid="button-publish-post" onClick={() => publishPost.mutate()} disabled={publishPost.isPending || !postBody.trim()} className="lime-button rounded-lg px-4 py-2 text-xs font-semibold disabled:opacity-50">{publishPost.isPending ? 'Publishing…' : 'Publish post'}</button></div></Modal>;
    if (modal === 'vault') return <Modal title="Control the inner room." eyebrow="Vault / Access" onClose={closeModal}><div className="flex items-center justify-between panel-subtle rounded-xl p-4"><div><p className="text-sm font-medium">Default access</p><p className="text-xs text-muted-foreground mt-1">New vault items start private.</p></div><span className="font-mono-ui text-xs text-primary">Private</span></div><div className="space-y-4 mt-5"><label className="block text-sm">Link expiry<select data-testid="select-vault-expiry" className="input-studio w-full rounded-xl px-3.5 py-3 mt-2"><option>Never</option><option>7 days</option><option>30 days</option></select></label><label className="flex gap-3 items-center text-sm"><input type="checkbox" defaultChecked data-testid="checkbox-vault-downloads" className="accent-primary" /> Allow downloads for trusted listeners</label><label className="flex gap-3 items-center text-sm"><input type="checkbox" data-testid="checkbox-vault-forwarding" className="accent-primary" /> Disable link forwarding</label></div><div className="flex justify-end mt-7"><button type="button" data-testid="button-save-vault-policy" onClick={() => { notify('Vault access policy saved.'); closeModal(); }} className="lime-button rounded-lg px-4 py-2 text-xs font-semibold">Save policy</button></div></Modal>;
    if (modal === 'settings') return <Modal title="Keep the practical things tidy." eyebrow="Account / Preferences" onClose={closeModal}><div className="space-y-4">{[['Billing', 'Creator Pro · $12 / month'], ['Payout method', '•••• 2841 · verified'], ['Email', 'you@example.com']].map(([label, value], i) => <button type="button" key={label} data-testid={`button-account-setting-${i}`} onClick={() => notify(`${label} editor opened.`)} className="w-full panel-subtle rounded-xl p-4 flex items-center text-left"><span className="flex-1"><p className="text-sm">{label}</p><p className="text-xs text-muted-foreground mt-1">{value}</p></span></button>)}</div><button type="button" data-testid="button-close-settings" onClick={closeModal} className="w-full ghost-button rounded-xl py-2.5 text-xs mt-6">Done</button></Modal>;
    return null;
  };

  const currentTitle = navGroups.flatMap((group) => group.items).find((item) => item.id === view)?.label || 'Overview';
  const studioWorkspace = <>{view === 'overview' && <Overview onOpen={setModal} onPlay={() => setPlaying(!playing)} playing={playing} onNavigate={navigate} />}{view === 'activity' && <ActivityView onOpen={setModal} />}{view === 'releases' && <Releases onOpen={setModal} onNotify={notify} playing={playing} onPlay={() => setPlaying(!playing)} />}{view === 'vault' && <Vault onOpen={setModal} onNotify={notify} />}{view === 'station' && <Station onNotify={notify} />}{view === 'schedule' && <ScheduleView onNotify={notify} />}{view === 'audience' && <AudienceView onNotify={notify} />}{view === 'broadcast' && <Broadcast onOpen={setModal} onNotify={notify} live={liveBroadcast.isLive} />}{view === 'analytics' && <Analytics onNotify={notify} />}{view === 'earnings' && <Earnings onOpen={setModal} onNotify={notify} />}{view === 'profile' && <ProfileView onNotify={notify} />}{view === 'tools' && <Tools onNotify={notify} onOpen={setModal} />}{view === 'security' && <Security onNotify={notify} />}{view === 'settings' && <SettingsView onNotify={notify} />}</>;
  const workspace = mode === 'stack' ? <StackView engine={playerEngine} onOpen={setModal} onNotify={notify} /> : mode === 'play' ? <PlayerView engine={playerEngine} onOpen={setModal} onNotify={notify} /> : studioWorkspace;
  return <div className={cn('studio-app noise min-h-[100dvh]', mode !== 'studio' && 'listening-shell')}><audio ref={playerEngine.audioRef} hidden /><aside className={cn('sidebar-shell fixed z-50 inset-y-0 left-0 w-[248px] border-r border-white/[.07] flex flex-col md:translate-x-0', mode !== 'studio' && 'sidebar-hidden', mobileMenu ? 'mobile-drawer open' : 'mobile-drawer')}><div className="h-20 px-6 flex items-center gap-3 border-b border-white/[.07]"><Logo size={32} /><div><p className="font-display font-bold tracking-[-.03em]">Creator Studio</p><p className="font-mono-ui text-[9px] uppercase tracking-[.18em] text-muted-foreground">by Paperweight</p></div><IconButton label="Close mobile menu" onClick={() => setMobileMenu(false)} className="ml-auto md:hidden"><X size={16} /></IconButton></div><div className="px-4 py-5 flex items-center gap-3"><Avatar name={stationName} size="sm" /><div className="min-w-0"><p className="text-sm font-medium truncate">{stationName}</p></div><ChevronDown size={14} className="ml-auto text-muted-foreground" /></div><nav className="flex-1 px-3 overflow-y-auto sidebar-scroll">{navGroups.map((group) => <div key={group.label} className="mb-6"><p className="font-mono-ui text-[9px] uppercase tracking-[.2em] text-muted-foreground/60 px-3 mb-2">{group.label}</p>{group.items.map((item) => { const Icon = item.icon; return <button type="button" key={item.id} data-testid={`nav-${item.id}`} onClick={() => { setMode('studio'); navigate(item.id); }} className={cn('nav-item w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm mb-1 text-left', view === item.id && 'active')}><Icon size={16} /><span className="flex-1">{item.label}</span>{item.badge && <span className="font-mono-ui text-[9px] min-w-5 h-5 rounded-full bg-accent/15 text-accent flex items-center justify-center">{item.badge}</span>}</button>; })}</div>)}<div className="mb-6"><p className="font-mono-ui text-[9px] uppercase tracking-[.2em] text-muted-foreground/60 px-3 mb-2">Account</p><button type="button" data-testid="nav-security" onClick={() => { setMode('studio'); navigate('security'); }} className={cn('nav-item w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm mb-1 text-left', view === 'security' && 'active')}><ShieldCheck size={16} /> Security</button><button type="button" data-testid="nav-settings" onClick={() => { setMode('studio'); navigate('settings'); }} className={cn('nav-item w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-left', view === 'settings' && 'active')}><SettingsIcon size={16} /> Settings</button></div></nav><div className="p-4 border-t border-white/[.07] space-y-2"><div className="panel-subtle rounded-xl p-3"><div className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-primary" /><span className="font-mono-ui text-[9px] uppercase tracking-[.15em] text-primary">All systems clear</span></div><p className="text-[11px] text-muted-foreground mt-2">Last synced just now</p></div><button type="button" data-testid="button-sign-out" onClick={logout} className="nav-item w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs text-left text-muted-foreground"><LogOut size={14} /> Sign out</button></div></aside><div className={cn('fixed inset-0 z-40 bg-black/60 md:hidden mobile-overlay', mobileMenu && 'open')} onClick={() => setMobileMenu(false)} /><main className={cn('min-h-[100dvh]', mode === 'studio' ? 'md:pl-[248px]' : 'mode-main')}><header className="h-20 px-4 sm:px-8 lg:px-10 border-b border-white/[.07] flex items-center gap-4 sticky top-0 z-30 glass-header"><button type="button" aria-label="Open navigation menu" data-testid="button-open-mobile-menu" onClick={() => setMobileMenu(true)} className={cn('md:hidden ghost-button h-9 w-9 rounded-lg', mode !== 'studio' && 'hidden')}><Menu size={18} /></button><ModeSwitcher mode={mode} onChange={(nextMode) => { setMode(nextMode); setMobileMenu(false); }} /><div className="hidden lg:flex items-center gap-2 text-xs text-muted-foreground"><span>{mode === 'stack' ? 'Stack' : mode === 'play' ? 'Play' : 'Studio'}</span><ChevronRight size={13} /><span className="text-foreground">{mode === 'studio' ? currentTitle : mode === 'stack' ? 'Library' : 'Player'}</span></div><div className="ml-auto flex items-center gap-2"><button type="button" data-testid="button-preview-profile" onClick={() => notify('Public profile preview opened.')} className="hidden sm:flex ghost-button rounded-lg px-3 py-2 text-xs items-center gap-2"><Eye size={14} /> Preview profile</button><IconButton label="Open notifications" onClick={() => notify('No new notifications beyond your 4 activity signals.')}><Bell size={16} /></IconButton><button type="button" data-testid="button-header-avatar" onClick={() => { setMode('studio'); navigate('profile'); }} className="rounded-full"><Avatar name={stationName} size="sm" /></button></div></header><div className={cn('p-5 sm:p-8 lg:p-10 max-w-[1480px] mx-auto', mode !== 'studio' && 'mode-content')}>{workspace}</div></main>{modalContent()}{toast && <div data-testid="status-toast" className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[90] panel rounded-xl px-4 py-3 text-sm flex items-center gap-2 shadow-2xl animate-enter"><Check size={15} className="text-primary" /> {toast}</div>}</div>;
}
