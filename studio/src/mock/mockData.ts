// TEMPORARY placeholder data ported verbatim from the Paperplate mockup.
// Phase 2 (creator dashboard) and Phase 3 (listener/public player) replace
// every one of these with real data fetched via ../lib/api (client/js/api.js)
// — see the migration plan for the view-by-view checklist. Nothing in this
// file should still be imported once those phases are complete.
import {
  Activity, BarChart3, Boxes, Disc3, Heart, LayoutDashboard, LockKeyhole, Radio,
  TrendingUp, UserRound, Users, Wallet,
} from 'lucide-react';

import type { Track, ViewKey } from '@/types';

export const tracks: Track[] = [
  { id: 1, title: 'Night Bloom', artist: 'Luna Vale', collection: 'Afterimage', duration: '3:42', plays: '184.2K', color: '#a9d647' },
  { id: 2, title: 'Body Language', artist: 'Luna Vale', collection: 'Afterimage', duration: '4:06', plays: '92.8K', color: '#ff816e' },
  { id: 3, title: 'Slow Motion', artist: 'Luna Vale', collection: 'Afterimage', duration: '3:18', plays: '67.4K', color: '#818cf3' },
  { id: 4, title: 'Nocturne FM — 042', artist: 'Luna Vale', collection: 'Nocturne FM', duration: '58:00', plays: '11.3K', kind: 'Broadcast', color: '#e7a85b' },
  { id: 5, title: 'Glasshouse', artist: 'Luna Vale', collection: 'Sketchbook', duration: '2:54', plays: '8.6K', kind: 'Demo', color: '#6dc0bd' },
];

export const collections = [
  { id: 1, title: 'Afterimage', type: 'EP · 2025', count: '3 tracks', tone: 'lime', note: 'The light stays after the room is empty.' },
  { id: 2, title: 'Nocturne FM', type: 'Broadcast archive', count: '42 episodes', tone: 'coral', note: 'Late transmissions for open windows.' },
  { id: 3, title: 'Sketchbook', type: 'Private vault', count: '18 works in progress', tone: 'blue', note: 'Small things, before they become songs.' },
];

export const activity = [
  { icon: TrendingUp, title: 'Night Bloom crossed 180K plays', detail: '2 hours ago', color: 'lime' },
  { icon: Users, title: '41 new subscribers joined', detail: 'Yesterday · +18% from last week', color: 'coral' },
  { icon: Radio, title: 'Nocturne FM — 042 went live', detail: 'Yesterday · 58 listeners tuned in', color: 'blue' },
  { icon: Heart, title: 'Afterimage was added to 124 playlists', detail: 'Mar 18 · 7:42 PM', color: 'pink' },
];


export const navGroups: { label: string; items: { id: ViewKey; label: string; icon: typeof LayoutDashboard; badge?: string }[] }[] = [
  { label: 'Studio', items: [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'activity', label: 'Activity', icon: Activity, badge: '4' },
    { id: 'releases', label: 'Releases', icon: Disc3 },
    { id: 'vault', label: 'Vault', icon: LockKeyhole },
  ] },
  { label: 'Signal', items: [
    { id: 'broadcast', label: 'Live broadcast', icon: Radio },
    { id: 'analytics', label: 'Analytics', icon: BarChart3 },
    { id: 'earnings', label: 'Earnings', icon: Wallet },
  ] },
  { label: 'Identity', items: [
    { id: 'profile', label: 'Profile & bio', icon: UserRound },
    { id: 'tools', label: 'Creator tools', icon: Boxes },
  ] },
];

export const supportOptionsEarnings: { title: string; body: string; amount: string; icon: typeof Heart }[] = [
  { title: 'Tips', body: 'Let listeners leave a little love.', amount: '$98.30', icon: Heart },
  { title: 'Subscribe', body: 'A monthly room for regulars.', amount: '$286.40', icon: Users },
  { title: 'All-access', body: 'Deep access to the full vault.', amount: '$44.00', icon: LockKeyhole },
];
