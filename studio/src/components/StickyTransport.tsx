import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Bookmark, BookmarkCheck, LockKeyhole, Pause, Play, SkipBack, SkipForward } from 'lucide-react';

import * as api from '@/lib/api';
import { canStash, isPlayableTrack, type OnDemandTrack, type PlayerEngine } from '@/lib/hooks/usePlayerEngine';
import { useOfflineSaves } from '@/lib/hooks/useOfflineSaves';
import { swatchFor, type LibraryItem, type LibraryStructure } from '@/lib/library';
import { cn } from '@/lib/utils';

function toOnDemandTrack(item: LibraryItem): OnDemandTrack {
  return { id: item.id, title: item.title, artist: item.artist, category: item.category, duration: item.duration, visibility: item.visibility || 'public', unlocked: item.unlocked, isExternal: item.isExternal, isVideo: item.isVideo, mimeType: item.mimeType };
}

// A persistent playback bar that survives Stack/Play/Studio tab switches
// (mounted alongside <main> in each shell, outside the mode-swapping
// ternary). Visible on the Stack and Studio tabs whenever there's a live or
// on-demand track to control, and on the Play tab only once the real
// player's own play button has scrolled out of view (see PlayerView's
// IntersectionObserver + onPlayButtonVisibilityChange) — no need to show a
// second set of controls on top of the ones already on screen there.
// Reuses the shell's single PlayerEngine instance rather than creating a
// second one. `offsetForSidebar` mirrors the mode-switcher pill's own fix
// (AppShell.tsx): in Studio mode the creator sidebar reserves 248px on the
// left, so this fixed, full-width bar needs the same compensation to stay
// centered on the actual content area instead of the whole viewport.
export function StickyTransport({ engine, visible, offsetForSidebar, onTip, onNotify }: { engine: PlayerEngine; visible: boolean; offsetForSidebar?: boolean; onTip?: () => void; onNotify: (message: string) => void }) {
  const { data: structure } = useQuery<LibraryStructure>({ queryKey: ['library', 'structure'], queryFn: () => api.library.structure() });
  const offline = useOfflineSaves(onNotify);

  const allTracks = useMemo(() => {
    const projects = structure?.projects || [];
    const standalone = structure?.standalone || [];
    return [...projects.flatMap((project) => project.tracks), ...standalone];
  }, [structure]);

  const activeTrack = engine.track;
  // Stash applies to whatever's actually playing — an on-demand track, or
  // the live rotation's current track if it also happens to be a catalog item.
  const currentId = activeTrack?.id ?? engine.nowPlaying?.id ?? null;
  const libraryTrack = useMemo(() => (currentId != null ? allTracks.find((item) => item.id === currentId) || null : null), [allTracks, currentId]);
  const index = activeTrack ? allTracks.findIndex((item) => item.id === activeTrack.id) : -1;

  const saved = libraryTrack ? offline.savedIds.has(libraryTrack.id) : false;
  const stashable = libraryTrack ? canStash(libraryTrack, engine.isPaid) : false;

  // Skip is an on-demand-only, fully-playable-track perk — not for live
  // station audio and not for a locked track's 30s preview.
  const skipLocked = !engine.isPaid || engine.isPreview || !isPlayableTrack({ visibility: activeTrack?.visibility || 'public', unlocked: activeTrack?.unlocked, isExternal: activeTrack?.isExternal }, engine.isPaid);
  const hasPrev = index > 0;
  const hasNext = index >= 0 && index < allTracks.length - 1;

  const skip = (direction: -1 | 1) => {
    if (skipLocked) { onNotify('Skip is a supporter perk.'); return; }
    const neighbor = allTracks[index + direction];
    if (!neighbor) return;
    engine.selectTrack(toOnDemandTrack(neighbor));
  };

  const hasTrack = !!(activeTrack || engine.nowPlaying);
  const title = activeTrack?.title || engine.nowPlaying?.title || engine.stationName;
  const subtitle = activeTrack ? activeTrack.artist : (engine.nowPlaying?.artist || 'Live');
  const reduceMotion = useReducedMotion();

  return (
    <AnimatePresence>
      {hasTrack && visible && (
        <motion.div
          className={cn('sticky-transport visible', offsetForSidebar && 'sticky-transport-sidebar-offset')}
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={reduceMotion ? { duration: 0.12 } : { type: 'spring', bounce: 0, duration: 0.35 }}
        >
      <div className="sticky-transport-inner">
        <div className="sticky-transport-meta">
          <span className="sticky-transport-swatch" style={{ background: `linear-gradient(135deg, ${swatchFor(activeTrack?.id ?? 0)}, rgba(255,255,255,.1))` }} />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{title}</p>
            {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
          </div>
        </div>
        <div className="sticky-transport-controls">
          {activeTrack && (
            <button type="button" aria-label={skipLocked ? 'Previous track (supporter perk)' : 'Previous track'} data-testid="button-sticky-back" onClick={() => skip(-1)} disabled={!skipLocked && !hasPrev} className={cn('ghost-button h-9 w-9 rounded-full inline-flex items-center justify-center disabled:opacity-40', skipLocked && 'opacity-60')}>
              {skipLocked ? <LockKeyhole size={13} /> : <SkipBack size={15} />}
            </button>
          )}
          {onTip && (
            <button type="button" aria-label="Send a tip" data-testid="button-sticky-tip" onClick={onTip} className="sticky-transport-tip">$</button>
          )}
          <button type="button" aria-label={engine.playing ? 'Pause' : 'Play'} data-testid="button-sticky-toggle" onClick={engine.toggle} className="sticky-transport-play">
            {engine.playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}
          </button>
          {activeTrack && (
            <button type="button" aria-label={skipLocked ? 'Next track (supporter perk)' : 'Next track'} data-testid="button-sticky-forward" onClick={() => skip(1)} disabled={!skipLocked && !hasNext} className={cn('ghost-button h-9 w-9 rounded-full inline-flex items-center justify-center disabled:opacity-40', skipLocked && 'opacity-60')}>
              {skipLocked ? <LockKeyhole size={13} /> : <SkipForward size={15} />}
            </button>
          )}
          {libraryTrack && stashable && (
            <button type="button" aria-label={saved ? `Remove ${libraryTrack.title} from stash` : `Save ${libraryTrack.title} to stash`} data-testid="button-sticky-stash" onClick={() => (saved ? offline.remove(libraryTrack.id) : offline.save(libraryTrack))} className="ghost-button h-9 w-9 rounded-full inline-flex items-center justify-center">
              {saved ? <BookmarkCheck size={15} className="text-primary" /> : <Bookmark size={15} />}
            </button>
          )}
        </div>
      </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
