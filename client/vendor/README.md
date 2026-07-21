# Vendored frontend dependencies

These files are committed so the frontend has **no runtime CDN dependency**.
They are not installed via npm at runtime — update them manually when needed.

## hls.js

hls.js is bundled from `node_modules/hls.js/dist/hls.min.js` and served at
`/vendor/hls.min.js` by `src/index.js` (see `pkg.assets` in `package.json` for
the packaged-exe asset). It is intentionally not committed here.

## Matter.js

Matter.js is served at `/vendor/matter.min.js` from `node_modules` when
available, with the generated client bundle and `matter.min.js` here as local
fallbacks.

## qrcode.js

Vendored verbatim from `qrcode-generator` (MIT, Kazuhiko Arase),
`dist/qrcode.js` — a single dependency-free file with no further deps of its
own. Used only by the "Authorized Devices" mobile Studio pairing panel to
render the pairing link as a scannable QR code client-side; not installed via
npm (kept out of `package.json` entirely, same rationale as the rest of this
directory). To refresh: `npm install --no-save qrcode-generator`, copy
`node_modules/qrcode-generator/dist/qrcode.js` here, then
`npm uninstall --no-save qrcode-generator`.

## Fonts (`fonts/`)

Latin `woff2` files sourced from the `@fontsource` packages (Google Fonts):

- `dm-serif-display-latin-400-{normal,italic}.woff2` — `@fontsource/dm-serif-display`
- `space-mono-latin-{400,700}-normal.woff2` — `@fontsource/space-mono`
- `inter-latin-{400,500,600,700}-normal.woff2` — `@fontsource/inter`
- `dm-mono-latin-{400,500}-normal.woff2` — `@fontsource/dm-mono`

`fonts.css` declares the `@font-face` rules used by `client/creator.html` and
the split creator stylesheets under `client/css/`.

To refresh: `npm install @fontsource/<family>`, copy the needed
`files/*-latin-*-normal.woff2` here, and keep the `@font-face` declarations in
sync.
