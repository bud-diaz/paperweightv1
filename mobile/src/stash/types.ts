export type StashRecord = {
  /** `${canonicalBaseUrl}::${trackId}` — see canonicalizeBaseUrl in stashStore.ts. */
  key: string;
  canonicalBaseUrl: string;
  stationName: string;
  trackId: number;
  title: string;
  artist: string | null;
  mimeType: string | null;
  sizeBytes: number;
  localUri: string;
  savedAt: string;
};
