// client/vendor/hls.min.js (loaded via a classic <script> in index.html)
// attaches a global `Hls` constructor — see client/js/dashboard/live.js and
// liveVideo.js for the reference usage (on-air waveform/preview taps) this
// type mirrors. Typed loosely since only a handful of methods are used here.
export {};

declare global {
  interface Window {
    Hls?: {
      new (config?: Record<string, unknown>): {
        loadSource: (url: string) => void;
        attachMedia: (media: HTMLMediaElement) => void;
        destroy: () => void;
      };
      isSupported: () => boolean;
    };
  }
}
