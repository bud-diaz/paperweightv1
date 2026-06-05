# Paperweight

Self-hosted internet radio for creators who want to run a station from their own machine.

Paperweight scans a local media vault, broadcasts a continuous HLS stream with FFmpeg, serves a listener player, and gives the creator a local dashboard for scheduling, uploads, tokens, listener accounts, vault pricing, analytics, and payments.

It is built for a single creator or small team running one station on a Windows PC, Raspberry Pi, Linux box, mini PC, or packaged executable install. It is not a multi-tenant SaaS platform.

## What It Does

- Live broadcast from local audio/video files using FFmpeg and HLS.
- Listener web player with now-playing state and library browsing.
- Vault scanner that indexes files from `vault/`.
- Visibility controls: public, supporters-only, and vault.
- Listener accounts with email and password.
- Creator-issued access tokens and account token assignments.
- Stripe subscriptions, tips, and vault unlock checkout.
- PayPal subscriptions with verified webhook handling when configured.
- Creator dashboard for media, scheduling, uploads, tokens, payments, and analytics.
- Packaged Windows executable build via `@yao-pkg/pkg`.

## Requirements

- Node.js 18 or newer.
- FFmpeg and ffprobe on `PATH`.
- 2 GB RAM minimum, 4 GB recommended.
- Disk space for your media vault.

## Quick Start

```bash
npm install
bash scripts/setup.sh
npm run preflight
npm start
```

Station:

```text
http://localhost:3000
```

Dashboard:

```text
http://localhost:3000/#dashboard
```

Use the dashboard token printed by `scripts/setup.sh`.

## Setup Guides

- Raspberry Pi / Linux: [SETUP.md](SETUP.md)
- Windows: [SETUP_WINDOWS.md](SETUP_WINDOWS.md)
- Operations: [OPERATIONS.md](OPERATIONS.md)
- Security: [SECURITY.md](SECURITY.md)
- Release checklist: [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md)

## Access Tiers

| Tier | Access |
|---|---|
| `free` | Public tracks only |
| `subscriber` | Public + supporters-only tracks |
| `pro` | Everything in subscriber |
| `all_access` | All content including vault when the creator enables all-access vault inclusion |

Listeners get a tier by redeeming a creator token, subscribing through a configured payment provider, or having a token assigned directly to their listener account.

## Visibility

| Setting | Who can play |
|---|---|
| `public` | Everyone |
| `supporters_only` | Subscriber tier and above, or scoped token holders |
| `vault` | Paid unlock, scoped token, project unlock, or enabled all-access |

## Release Checks

Before building an executable, run:

```bash
npm run preflight
npm run check:migrations
npm run check:scheduler
npm run check:analytics
npm run check:package
npm audit --omit=dev
```

Then build:

```bash
npm run build:exe
```

## Project Layout

```text
client/
  creator.html          single-file player and creator dashboard
  index.html            optional landing/about page at /landing
src/
  api/                  Express API routes
  auth/                 listener tokens, tiers, access checks
  broadcast/            FFmpeg HLS engine, playlist, scheduler
  db/                   SQLite migrations and helpers
  middleware/           CSRF and rate limit middleware
  scanner/              vault watcher, adapters, ffprobe metadata
scripts/
  setup.sh              interactive .env and folder setup
  preflight.js          release/runtime readiness check
  check-migrations.js   migration idempotency check
  check-scheduler.js    schedule edge-case check
  check-analytics.js    analytics write-path check
  smoke.js              HTTP smoke test against a running server
```

Runtime data:

```text
vault/                  media files
data/                   SQLite database
logs/                   process logs
hls_output/             generated HLS segments and previews
```

These runtime folders are ignored by Git and live next to the executable in packaged mode.

## License

Paperweight Systems LLC
