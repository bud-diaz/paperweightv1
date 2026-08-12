// client/vendor/hls.min.js (loaded via a classic <script> in index.html)
// attaches a global `Hls` constructor — see client/js/dashboard/live.js,
// liveVideo.js (on-air waveform/preview taps), and client/js/hls-client.js
// (primary station playback) for the reference usage this type mirrors.
// Typed loosely since only a handful of methods are used here.
export {};

declare global {
  interface Window {
    Hls?: {
      new (config?: Record<string, unknown>): {
        loadSource: (url: string) => void;
        attachMedia: (media: HTMLMediaElement) => void;
        destroy: () => void;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        on: (event: string, handler: (event: string, data: any) => void) => void;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        off: (event: string, handler: (event: string, data: any) => void) => void;
      };
      isSupported: () => boolean;
      Events: { MANIFEST_LOADED: string; ERROR: string };
    };
  }
}
