// The Paperweight brand mark used inside the web app chrome. This uses the
// transparent, tightly-cropped mark instead of the favicon/app icon so the
// mobile header blends into the black background without a placeholder box.
export function Logo({ size = 32 }: { size?: number }) {
  return (
    <img
      src="/brand-mark.png"
      alt="Paperweight"
      width={size}
      height={size}
      className="shrink-0 object-contain"
      style={{ width: size, height: size }}
    />
  );
}
