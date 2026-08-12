export type ViewKey =
  | 'overview'
  | 'activity'
  | 'releases'
  | 'vault'
  | 'station'
  | 'schedule'
  | 'audience'
  | 'broadcast'
  | 'analytics'
  | 'earnings'
  | 'profile'
  | 'tools'
  | 'security'
  | 'settings';

export type ModeKey = 'stack' | 'play' | 'studio';

export type ModalKey =
  | 'upload'
  | 'collection'
  | 'live'
  | 'support'
  | 'share'
  | 'newShareLink'
  | 'library'
  | 'posts'
  | 'tipConfig'
  | 'settings'
  | 'vault'
  | null;

export type CreatorPost = { id: number; title: string | null; body: string; visibility: 'public' | 'supporters_only'; published_at: string };

export type Track = {
  id: number;
  title: string;
  artist: string;
  collection: string;
  duration: string;
  plays: string;
  kind?: string;
  color: string;
};
