// client/vendor/qrcode.js (loaded via a classic <script> in index.html)
// attaches a global `qrcode` factory — see client/js/dashboard/devices.js
// for the reference usage this type mirrors.
export {};

declare global {
  interface Window {
    qrcode?: (typeNumber: number, errorCorrectionLevel: string) => {
      addData: (data: string) => void;
      make: () => void;
      createSvgTag: (cellSize?: number, margin?: number) => string;
    };
  }
}
