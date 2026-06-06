# Vendored frontend dependencies

These files are committed so the frontend has **no runtime CDN dependency**.
They are not installed via npm at runtime — update them manually when needed.

## hls.js

- `hls.min.js` — hls.js **1.6.16**, the UMD build.
- Source: `node_modules/hls.js/dist/hls.min.js` after `npm install hls.js@1`.

## Fonts (`fonts/`)

Latin `woff2` files sourced from the `@fontsource` packages (Google Fonts):

- `dm-serif-display-latin-400-{normal,italic}.woff2` — `@fontsource/dm-serif-display`
- `space-mono-latin-{400,700}-normal.woff2` — `@fontsource/space-mono`
- `inter-latin-{400,500,600,700}-normal.woff2` — `@fontsource/inter`
- `dm-mono-latin-{400,500}-normal.woff2` — `@fontsource/dm-mono`

`fonts.css` declares the `@font-face` rules used by `client/creator.html`. The
landing page (`client/index.html` via `client/styles.css`) declares its own
`@font-face` rules inline, pointing at the same `woff2` files.

To refresh: `npm install @fontsource/<family>`, copy the needed
`files/*-latin-*-normal.woff2` here, and keep the `@font-face` declarations in
sync.
