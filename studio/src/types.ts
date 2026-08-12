export type ViewKey =
  | 'overview'
  | 'activity'
  | 'releases'
  | 'vault'
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
  | 'library'
  | 'posts'
  | 'settings'
  | 'vault'
  | null;

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

export type Profile = {
  name: string;
  handle: string;
  bio: string;
  city: string;
  instagram: string;
  youtube: string;
};
