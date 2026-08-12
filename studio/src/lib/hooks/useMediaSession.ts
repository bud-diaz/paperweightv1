import { useEffect } from 'react';

// Ports client/js/media-session.js. On mobile this is load-bearing, not just
// cosmetic: without a registered Media Session, backgrounding the tab (or
// switching apps from a home-screen install) makes iOS Safari suspend the
// audio graph outright rather than just hiding the UI. No-ops everywhere the
// API isn't supported.
export function useMediaSession({ playing, title, artist, album, onPlay, onPause }: {
  playing: boolean;
  title?: string;
  artist?: string;
  album?: string;
  onPlay: () => void;
  onPause: () => void;
}) {
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const set = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try { navigator.mediaSession.setActionHandler(action, handler); } catch { /* action unsupported */ }
    };
    set('play', onPlay);
    set('pause', onPause);
    return () => { set('play', null); set('pause', null); };
  }, [onPlay, onPause]);

  useEffect(() => {
    if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: title || '', artist: artist || '', album: album || '' });
    } catch { /* metadata construction failed */ }
  }, [title, artist, album]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    try { navigator.mediaSession.playbackState = playing ? 'playing' : 'paused'; } catch { /* unsupported */ }
  }, [playing]);
}
