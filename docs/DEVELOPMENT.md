# Development Workflow

Use the source dev server while building Paperweight locally. It serves the app
from this checkout, so you do not need to rebuild, uninstall, or reinstall the
desktop package after each change.

## Browser Dev Server

```bash
npm run dev
```

Open:

```text
http://localhost:3000/creator.html
```

What updates automatically:

- Changes under `src/` restart the Node server through nodemon.
- Changes under `client/` or `landing/` reload open browser tabs through the
  dev-only live reload endpoint.
- Runtime folders such as `data/`, `logs/`, `hls_output/`, and `vault/` are
  ignored so normal app activity does not cause restart loops.

Use `npm run dev:plain` if you want the old nodemon behavior without live
reload injection.

## Desktop Dev App

```bash
npm run dev:desktop
```

This launches Electron from source and uses the repo root as
`PAPERWEIGHT_DATA_ROOT`, so it reads the same `.env`, `data/`, `vault/`, logs,
and HLS output as `npm run dev`.

What updates automatically:

- Changes under `src/` or `electron/` restart the Electron dev app.
- Changes under `client/` or `landing/` reload the open Paperweight window.

If Electron dependencies are missing, install them once:

```bash
npm install --prefix electron
```
