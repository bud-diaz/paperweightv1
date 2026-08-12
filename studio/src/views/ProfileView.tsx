import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ExternalLink } from 'lucide-react';

import { Field, ViewHeader } from '@/components/primitives';
import { useStationIdentity } from '@/lib/hooks/useStationIdentity';
import * as api from '@/lib/api';

type CreatorProfile = {
  bio_enabled: 0 | 1;
  bio: string | null;
  social_instagram: string | null;
  social_twitter: string | null;
  social_youtube: string | null;
  social_soundcloud: string | null;
  social_spotify: string | null;
  social_bandcamp: string | null;
  profile_pic_url: string | null;
};

type Draft = {
  bioEnabled: boolean;
  bio: string;
  instagram: string;
  twitter: string;
  youtube: string;
  soundcloud: string;
  spotify: string;
  bandcamp: string;
};

function draftFrom(profile: CreatorProfile | undefined): Draft {
  return {
    bioEnabled: !!profile?.bio_enabled,
    bio: profile?.bio || '',
    instagram: profile?.social_instagram || '',
    twitter: profile?.social_twitter || '',
    youtube: profile?.social_youtube || '',
    soundcloud: profile?.social_soundcloud || '',
    spotify: profile?.social_spotify || '',
    bandcamp: profile?.social_bandcamp || '',
  };
}

const SOCIAL_FIELDS: { key: keyof Draft; label: string }[] = [
  { key: 'instagram', label: 'Instagram' },
  { key: 'twitter', label: 'Twitter / X' },
  { key: 'youtube', label: 'YouTube' },
  { key: 'soundcloud', label: 'SoundCloud' },
  { key: 'spotify', label: 'Spotify' },
  { key: 'bandcamp', label: 'Bandcamp' },
];

export function ProfileView({ onNotify }: { onNotify: (message: string) => void }) {
  const { stationName } = useStationIdentity();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery<CreatorProfile>({ queryKey: ['dashboard', 'creator-profile'], queryFn: () => api.dashboard.creator.profile() });
  const [draft, setDraft] = useState<Draft>(draftFrom(undefined));
  const [picVersion, setPicVersion] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (data) setDraft(draftFrom(data)); }, [data]);

  const update = (key: keyof Draft, value: string | boolean) => setDraft((prev) => ({ ...prev, [key]: value }));

  const save = useMutation({
    mutationFn: () => api.dashboard.creator.updateProfile({
      bio_enabled: draft.bioEnabled ? 1 : 0,
      bio: draft.bio.trim() || null,
      social_instagram: draft.instagram.trim() || null,
      social_twitter: draft.twitter.trim() || null,
      social_youtube: draft.youtube.trim() || null,
      social_soundcloud: draft.soundcloud.trim() || null,
      social_spotify: draft.spotify.trim() || null,
      social_bandcamp: draft.bandcamp.trim() || null,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'creator-profile'] });
      onNotify('Profile changes saved.');
    },
    onError: () => onNotify('Failed to save profile.'),
  });

  const uploadPic = useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append('pic', file);
      return api.dashboard.creator.uploadPic(formData);
    },
    onSuccess: (res: Response) => {
      if (!res.ok) { onNotify('Failed to upload profile picture.'); return; }
      setPicVersion((v) => v + 1);
      onNotify('Profile picture updated.');
    },
    onError: () => onNotify('Failed to upload profile picture.'),
  });

  const hasPic = !!data?.profile_pic_url;

  return (
    <div className="animate-enter">
      <ViewHeader
        eyebrow="Identity / Profile"
        title="Make the doorway yours."
        description={`This is the version of ${stationName} the outside world meets.`}
        action={<button type="button" data-testid="button-save-profile" onClick={() => save.mutate()} disabled={save.isPending || isLoading} className="lime-button rounded-xl px-4 py-2.5 text-sm font-semibold flex items-center gap-2 disabled:opacity-50"><Check size={15} /> {save.isPending ? 'Saving…' : 'Save changes'}</button>}
      />
      <div className="grid lg:grid-cols-[.74fr_1.26fr] gap-6">
        <section className="panel rounded-2xl p-5 sm:p-7">
          <div className="flex flex-col items-center text-center">
            {hasPic ? (
              <img data-testid="img-profile-pic" src={`/api/creator/pic?v=${picVersion}`} alt={stationName} className="h-20 w-20 rounded-full object-cover" onError={(event) => { event.currentTarget.style.display = 'none'; }} />
            ) : (
              <div className="h-20 w-20 rounded-full flex items-center justify-center font-display font-bold text-black text-xl" style={{ background: 'linear-gradient(135deg, #dcff75, #ff8071 75%)' }}>{stationName.slice(0, 2).toUpperCase()}</div>
            )}
            <input ref={fileInputRef} type="file" accept="image/*" hidden data-testid="input-profile-pic" onChange={(event) => { const file = event.target.files?.[0]; if (file) uploadPic.mutate(file); }} />
            <button type="button" data-testid="button-change-avatar" onClick={() => fileInputRef.current?.click()} disabled={uploadPic.isPending} className="text-xs text-primary mt-4 disabled:opacity-50">{uploadPic.isPending ? 'Uploading…' : 'Change picture'}</button>
            <h2 className="font-display text-2xl font-semibold mt-5">{stationName}</h2>
            <div className="w-full mt-6 pt-5 border-t border-white/[.08] flex items-center justify-between gap-4">
              <div className="flex-1 text-left">
                <p className="text-sm">Public bio page</p>
                <p className="text-xs text-muted-foreground mt-1">{draft.bioEnabled ? 'Visible to visitors' : 'Hidden'}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={draft.bioEnabled}
                data-testid="toggle-bio-enabled"
                onClick={() => update('bioEnabled', !draft.bioEnabled)}
                className={`h-7 w-12 rounded-full p-1 transition-colors shrink-0 ${draft.bioEnabled ? 'bg-primary' : 'bg-white/15'}`}
              >
                <span className={`block h-5 w-5 rounded-full bg-[#171a28] transition-transform ${draft.bioEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            </div>
          </div>
        </section>
        <section className="panel rounded-2xl p-5 sm:p-7">
          <div className="flex items-center justify-between mb-6">
            <div>
              <p className="font-mono-ui text-[10px] uppercase tracking-[.2em] text-primary">Public identity</p>
              <h2 className="font-display text-xl font-semibold mt-1">Tell them who you are.</h2>
            </div>
            <a href="/landing/listen" target="_blank" rel="noopener noreferrer" data-testid="link-preview-bio" className="text-xs text-primary flex items-center gap-1"><ExternalLink size={13} /> Preview</a>
          </div>
          <div className="space-y-5">
            <Field label="Bio" value={draft.bio} multiline onChange={(value) => update('bio', value)} placeholder="What should visitors know about you?" />
          </div>
          <div className="mt-7 pt-5 border-t border-white/[.08]">
            <p className="font-display text-lg font-semibold">Social links</p>
            <div className="grid sm:grid-cols-2 gap-4 mt-4">
              {SOCIAL_FIELDS.map(({ key, label }) => (
                <Field key={key} label={label} value={draft[key] as string} onChange={(value) => update(key, value)} placeholder="https://…" />
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
