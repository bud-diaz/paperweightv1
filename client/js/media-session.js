/**
 * media-session.js — Media Session API wiring.
 *
 * Gives the OS a recognized "Now Playing" session (lock-screen / notification
 * transport controls). On mobile this is also what keeps background audio
 * alive at all: without a registered Media Session, backgrounding the tab
 * (or switching apps while the site is added to the home screen) makes iOS
 * Safari treat the page as regular background JS rather than active media
 * playback, and it suspends the audio graph outright rather than just
 * hiding the UI. No-ops everywhere if the API isn't supported.
 */

const supported = typeof navigator !== 'undefined' && 'mediaSession' in navigator;

let lastMetaKey = null;

export function initActionHandlers({ onPlay, onPause, onNext, onPrevious, onSeekTo, onStop } = {}) {
  if (!supported) return;
  const set = (action, handler) => {
    try { navigator.mediaSession.setActionHandler(action, handler || null); } catch {}
  };
  set('play',         onPlay);
  set('pause',        onPause);
  set('nexttrack',    onNext);
  set('previoustrack', onPrevious);
  set('stop',         onStop);
  set('seekto',       onSeekTo ? (details) => onSeekTo(details.seekTime) : null);
}

export function updateMetadata({ title, artist, album, artworkUrl } = {}) {
  if (!supported || typeof MediaMetadata === 'undefined') return;
  const key = `${title}|${artist}|${album}|${artworkUrl}`;
  if (key === lastMetaKey) return;
  lastMetaKey = key;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title:  title  || '',
      artist: artist || '',
      album:  album  || '',
      artwork: artworkUrl ? [{ src: artworkUrl, sizes: '512x512', type: 'image/png' }] : [],
    });
  } catch {}
}

export function setPlaying(isPlaying) {
  if (!supported) return;
  try { navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused'; } catch {}
}

export function setPositionState({ duration, position, playbackRate = 1 } = {}) {
  if (!supported || !navigator.mediaSession.setPositionState) return;
  if (!Number.isFinite(duration) || duration <= 0) return;
  const clampedPosition = Math.min(Math.max(position || 0, 0), duration);
  try { navigator.mediaSession.setPositionState({ duration, position: clampedPosition, playbackRate }); } catch {}
}

export function clearPositionState() {
  if (!supported || !navigator.mediaSession.setPositionState) return;
  try { navigator.mediaSession.setPositionState(); } catch {}
}
