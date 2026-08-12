import { useEffect, useState } from 'react';
import { useParams } from 'wouter';
import { AlertCircle } from 'lucide-react';

import { Logo } from '@/components/Logo';
import * as api from '@/lib/api';

type ShareTrack = {
  id: number;
  title: string;
  artist: string | null;
  category: string | null;
  duration: number | null;
  isVideo: boolean;
  streamUrl: string;
};

type ShareCollection = {
  name: string;
  description: string | null;
  tracks: ShareTrack[];
};

type ShareData = {
  label: string | null;
  expiresAt: string | null;
  track?: ShareTrack;
  collection?: ShareCollection;
  project?: ShareCollection;
};

function formatDuration(seconds: number | null | undefined) {
  if (!seconds || !Number.isFinite(seconds)) return '';
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Standalone entry point for `/share/:token` links (created from the
// dashboard's Tools view). No dashboard/listener auth involved — the token
// itself is the credential, same as client/js/main.js's
// maybeRenderPublicShare()/shareTokenFromPath() it replaces. Mounted outside
// AuthGate in App.tsx so it never waits on a dashboard-session check.
export default function Share() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [data, setData] = useState<ShareData | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    (async () => {
      try {
        const result = await api.share.resolve(token);
        if (result?.error) throw new Error(result.error);
        if (cancelled) return;
        setData(result);
        setActiveIndex(0);
        setState('ready');
      } catch {
        if (!cancelled) setState('error');
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const collection = data?.collection || data?.project || null;
  const tracks = data?.track ? [data.track] : collection?.tracks || [];
  const active = tracks[activeIndex] || null;
  const title = data?.label || data?.track?.title || collection?.name || 'Shared content';
  const subtitle = collection
    ? `${collection.tracks.length} track${collection.tracks.length === 1 ? '' : 's'} in this collection${collection.description ? ' · ' + collection.description : ''}`
    : [data?.track?.artist, data?.track?.category].filter(Boolean).join(' · ');

  return (
    <div className="studio-app noise min-h-[100dvh] flex items-center justify-center p-5">
      <div className="w-full max-w-lg">
        <div className="flex items-center gap-2 justify-center mb-8">
          <Logo size={28} />
          <span className="font-mono-ui text-[10px] uppercase tracking-[.24em] text-primary">Shared link</span>
        </div>

        {state === 'loading' && (
          <div className="panel rounded-2xl p-8 text-center">
            <span className="h-2 w-2 rounded-full bg-primary animate-pulse inline-block" />
          </div>
        )}

        {state === 'error' && (
          <div className="panel rounded-2xl p-8 text-center" data-testid="share-error">
            <AlertCircle className="mx-auto text-destructive" size={28} />
            <h1 className="font-display text-2xl font-semibold mt-4">Share unavailable</h1>
            <p className="text-sm text-muted-foreground mt-2">
              This link is expired, revoked, or the shared content is no longer available.
            </p>
          </div>
        )}

        {state === 'ready' && active && (
          <div className="panel rounded-2xl p-6 sm:p-8" data-testid="share-ready">
            <p className="font-mono-ui text-[10px] uppercase tracking-[.22em] text-primary">
              {active.isVideo ? 'Shared video' : 'Shared audio'}
            </p>
            <h1 className="font-display text-3xl font-semibold mt-3">{title}</h1>
            {subtitle && <p className="text-muted-foreground mt-2">{subtitle}</p>}

            <div className="mt-6 rounded-xl overflow-hidden bg-black/30">
              {active.isVideo ? (
                <video key={active.id} controls preload="metadata" src={active.streamUrl} className="w-full" aria-label={active.title} />
              ) : (
                <audio key={active.id} controls preload="metadata" src={active.streamUrl} className="w-full" aria-label={active.title} />
              )}
            </div>

            {tracks.length > 1 && (
              <div className="mt-6">
                {tracks.map((track, index) => (
                  <button
                    key={track.id}
                    type="button"
                    data-testid={`share-track-${index}`}
                    onClick={() => setActiveIndex(index)}
                    className={`w-full flex items-center gap-3 py-2.5 px-3 rounded-lg text-left border-b border-white/[.07] last:border-0 ${index === activeIndex ? 'bg-primary/10' : ''}`}
                  >
                    <span className="font-mono-ui text-[11px] text-muted-foreground w-5">{index + 1}</span>
                    <span className="flex-1 min-w-0 text-sm truncate">{track.title}</span>
                    <span className="font-mono-ui text-[11px] text-muted-foreground">{formatDuration(track.duration)}</span>
                  </button>
                ))}
              </div>
            )}

            <p className="font-mono-ui text-[10px] text-muted-foreground mt-6">
              {data?.expiresAt ? `Expires ${new Date(data.expiresAt).toLocaleString()}` : 'No expiration set.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
