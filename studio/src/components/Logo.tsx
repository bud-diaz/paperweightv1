// The Paperweight brand mark. Served from client/favicon.png (already the
// app's icon everywhere else — client/creator.html, the PWA manifest) rather
// than the mockup's placeholder Aperture-icon-in-a-lime-square.
export function Logo({ size = 32 }: { size?: number }) {
  return (
    <img
      src="/favicon.png"
      alt="Paperweight"
      width={size}
      height={size}
      className="rounded-lg shrink-0"
      style={{ width: size, height: size }}
    />
  );
}
