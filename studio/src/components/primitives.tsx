import { type ReactNode, useEffect } from 'react';
import {
  Aperture, ArrowUpRight, Boxes, ChevronLeft, ChevronRight, Headphones,
  LayoutDashboard, MoreHorizontal, Pause, Play, Plus, Trash2, X,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import type { ModeKey, Track } from '@/types';

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}

export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <div data-testid="img-avatar" className={cn(
      'shrink-0 rounded-full flex items-center justify-center font-display font-bold text-black',
      size === 'sm' && 'h-8 w-8 text-[11px]',
      size === 'md' && 'h-10 w-10 text-xs',
      size === 'lg' && 'h-20 w-20 text-xl',
    )} style={{ background: 'linear-gradient(135deg, #dcff75, #ff8071 75%)' }}>{initials(name)}</div>
  );
}

export function Waveform({ compact = false }: { compact?: boolean }) {
  return (
    <div className={cn('flex items-end gap-[3px]', compact ? 'h-5' : 'h-10')} aria-label="Audio signal waveform">
      {Array.from({ length: compact ? 18 : 34 }, (_, index) => (
        <span key={index} className="wave-bar block w-[3px] rounded-full bg-primary" style={{ height: `${25 + ((index * 17) % 73)}%` }} />
      ))}
    </div>
  );
}

export function IconButton({ label, onClick, children, className = '' }: { label: string; onClick?: () => void; children: ReactNode; className?: string }) {
  return <button type="button" aria-label={label} data-testid={`button-${label.toLowerCase().replaceAll(' ', '-')}`} onClick={onClick} className={cn('h-9 w-9 rounded-lg inline-flex items-center justify-center ghost-button', className)}>{children}</button>;
}

export function Modal({ title, eyebrow, onClose, children, width = 'max-w-lg' }: { title: string; eyebrow?: string; onClose: () => void; children: ReactNode; width?: string }) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[70] modal-backdrop flex items-end sm:items-center justify-center p-0 sm:p-5" role="dialog" aria-modal="true">
      <button type="button" aria-label="Close dialog backdrop" data-testid="button-close-dialog-backdrop" className="absolute inset-0 cursor-default" onClick={onClose} />
      <div className={cn('relative w-full rounded-t-2xl sm:rounded-2xl panel p-5 sm:p-7 max-h-[92dvh] overflow-y-auto scrollbar-thin animate-enter', width)}>
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>{eyebrow && <p className="font-mono-ui text-[10px] uppercase tracking-[.22em] text-primary mb-2">{eyebrow}</p>}<h2 className="font-display text-2xl font-semibold">{title}</h2></div>
          <IconButton label="Close dialog" onClick={onClose}><X size={17} /></IconButton>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, value, onChange, placeholder, multiline = false }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; multiline?: boolean }) {
  const shared = { value, placeholder, onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(event.target.value), className: 'input-studio w-full rounded-xl px-3.5 py-3 text-sm' };
  return <label className="block text-sm text-muted-foreground">{label}{multiline ? <textarea {...shared} rows={4} className={cn(shared.className, 'resize-none mt-2')} /> : <input {...shared} className={cn(shared.className, 'mt-2')} />}</label>;
}

export function TrackRow({ track, index, playing, onPlay, onAdd, onRemove, onMoveUp, onMoveDown }: { track: Track; index: number; playing: boolean; onPlay: () => void; onAdd?: () => void; onRemove?: () => void; onMoveUp?: () => void; onMoveDown?: () => void }) {
  return (
    <div data-testid={`row-track-${track.id}`} className="group flex items-center gap-3 py-3 border-b border-white/[.07] last:border-0">
      <button type="button" aria-label={`Play ${track.title}`} data-testid={`button-play-track-${track.id}`} onClick={onPlay} className="relative h-9 w-9 shrink-0 rounded-md flex items-center justify-center overflow-hidden" style={{ background: `linear-gradient(135deg, ${track.color}, rgba(255,255,255,.1))` }}>
        {playing ? <Pause size={14} fill="currentColor" /> : <span className="font-mono-ui text-[10px] text-[#1b1d2a] group-hover:hidden">{String(index + 1).padStart(2, '0')}</span>}
        {!playing && <Play size={14} fill="currentColor" className="hidden group-hover:block text-[#1b1d2a]" />}
      </button>
      <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{track.title}</p><p className="truncate text-xs text-muted-foreground">{track.collection}{track.kind && ` · ${track.kind}`}</p></div>
      <span className="hidden sm:block font-mono-ui text-[11px] text-muted-foreground">{track.plays}</span>
      <span className="font-mono-ui text-[11px] text-muted-foreground w-10 text-right">{track.duration}</span>
      {onMoveUp && <IconButton label={`Move ${track.title} up`} onClick={onMoveUp} className="hidden sm:inline-flex opacity-50 group-hover:opacity-100"><ChevronLeft size={14} className="rotate-90" /></IconButton>}
      {onMoveDown && <IconButton label={`Move ${track.title} down`} onClick={onMoveDown} className="hidden sm:inline-flex opacity-50 group-hover:opacity-100"><ChevronRight size={14} className="rotate-90" /></IconButton>}
      {onAdd && <IconButton label={`Add ${track.title} to queue`} onClick={onAdd} className="opacity-60 group-hover:opacity-100"><Plus size={15} /></IconButton>}
      {onRemove && <IconButton label={`Remove ${track.title}`} onClick={onRemove} className="opacity-60 group-hover:opacity-100"><Trash2 size={14} /></IconButton>}
      <IconButton label={`More options for ${track.title}`} onClick={() => undefined} className="opacity-50 group-hover:opacity-100"><MoreHorizontal size={15} /></IconButton>
    </div>
  );
}

export function Metric({ label, value, change, icon: Icon, accent = 'lime' }: { label: string; value: string; change: string; icon: typeof Play; accent?: 'lime' | 'coral' | 'blue' }) {
  const colors = { lime: 'text-primary bg-primary/10', coral: 'text-accent bg-accent/10', blue: 'text-white/80 bg-white/10' };
  return <div className="panel rounded-2xl p-4 sm:p-5"><div className="flex items-start justify-between gap-2"><span className="text-xs text-muted-foreground">{label}</span><span className={cn('rounded-lg p-2', colors[accent])}><Icon size={15} /></span></div><p className="font-display text-2xl sm:text-3xl font-semibold mt-4 tracking-tight">{value}</p><p className={cn('font-mono-ui text-[10px] mt-2', accent === 'coral' ? 'text-accent' : 'text-primary')}>{change}</p></div>;
}

export function ViewHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-7"><div><p className="font-mono-ui text-[10px] uppercase tracking-[.24em] text-primary mb-2">{eyebrow}</p><h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-[-.04em]">{title}</h1><p className="text-sm text-muted-foreground mt-2 max-w-xl">{description}</p></div>{action}</div>;
}

export function EmptyState({ icon: Icon, title, body, action, onClick }: { icon: typeof Play; title: string; body: string; action: string; onClick: () => void }) {
  return <div className="py-12 text-center"><span className="mx-auto h-11 w-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center"><Icon size={19} /></span><h3 className="font-display text-lg font-semibold mt-4">{title}</h3><p className="text-sm text-muted-foreground mt-2">{body}</p><button type="button" data-testid="button-empty-state-action" onClick={onClick} className="lime-button rounded-lg px-3 py-2 text-xs font-semibold mt-5">{action}</button></div>;
}

export function ActionCard({ icon: Icon, title, body, onClick }: { icon: typeof Play; title: string; body: string; onClick: () => void }) {
  return <button type="button" data-testid={`button-action-${title.toLowerCase().replaceAll(' ', '-')}`} onClick={onClick} className="panel rounded-2xl p-5 text-left group hover:bg-white/[.06]"><Icon size={18} className="text-primary" /><p className="font-display text-lg font-semibold mt-5">{title}</p><p className="text-xs text-muted-foreground mt-1">{body}</p><span className="text-xs text-primary inline-flex gap-1 items-center mt-5">Open <ArrowUpRight size={13} className="transition-transform group-hover:translate-x-1" /></span></button>;
}

// Decorative glyph only (a small ornament inside the mode-switcher pill) —
// this is not the brand mark. The actual Paperweight logo lives in the
// sidebar header (see Logo.tsx / AppShell.tsx).
export function ModeSwitcher({ mode, onChange }: { mode: ModeKey; onChange: (mode: ModeKey) => void }) {
  const modes: { id: ModeKey; label: string; icon: typeof Play }[] = [
    { id: 'stack', label: 'STACK', icon: Boxes },
    { id: 'play', label: 'PLAY', icon: Headphones },
    { id: 'studio', label: 'STUDIO', icon: LayoutDashboard },
  ];
  return (
    <div className="mode-switcher" role="tablist" aria-label="Workspace view">
      <span className="mode-switcher-mark" aria-hidden="true"><Aperture size={13} /></span>
      {modes.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={mode === id}
          data-testid={`mode-${id}`}
          onClick={() => onChange(id)}
          className={cn('mode-option', mode === id && 'active')}
        >
          <Icon size={13} />
          <span className="mode-label">{label}</span>
        </button>
      ))}
    </div>
  );
}
