# Release Checklist

Use this before building or distributing a Paperweight executable.

## Required Environment

- Node.js 18 or newer is installed.
- `npm install` has completed successfully.
- FFmpeg and ffprobe are installed and available on `PATH`.
- `.env` exists and has a permanent `DASHBOARD_TOKEN`.
- The vault path exists and contains the expected category folders.

## Pre-Build Checks

Run:

```bash
npm run preflight
npm run check:migrations
npm run check:scheduler
npm run check:analytics
npm run check:package
npm audit --omit=dev
```

Expected result:

- Preflight has no `FAIL` items.
- Migration, scheduler, and analytics checks pass.
- npm audit reports zero production vulnerabilities.

## Manual Smoke Pass

Start the app:

```bash
npm start
```

Then verify:

- `http://localhost:3000/api/health` returns `status: ok`.
- `http://localhost:3000` serves the player.
- The dashboard rejects an empty or wrong dashboard token.
- The dashboard accepts the token from `.env`.
- Uploading a small audio file creates a media row.
- The library shows public media.
- A `supporters_only` item is hidden or gated for free listeners.
- A `vault` item shows locked pricing options.
- `/api/stream/ping` updates analytics after something is now-playing.

Run the HTTP smoke check while the app is running:

```bash
npm run smoke
```

## Build

Run:

```bash
npm run build:exe
```

The Windows executable is written to `dist/`.

## Packaged Executable Smoke Pass

Copy the executable into a clean folder and run it there.

Verify:

- A default `.env` is created next to the executable on first run.
- `data/`, `logs/`, `vault/`, and `hls_output/` are created next to the executable.
- The generated dashboard token appears in the console.
- After editing `.env` and restarting, `/api/health` returns the configured station name.
- The executable can load `better-sqlite3`.
- The player loads without needing source files outside the executable.

## Do Not Ship If

- Preflight fails.
- `npm audit --omit=dev` reports production vulnerabilities.
- Migration check fails or mentions `media_new`.
- PayPal is configured but webhook verification fails in dashboard logs.
- Stripe payments are enabled without `STRIPE_WEBHOOK_SECRET`.
- FFmpeg or ffprobe are missing from the target machine.
