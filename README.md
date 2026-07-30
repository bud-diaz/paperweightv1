# Paperweight

Self-hosted, creator-first streaming and distribution.

Paperweight turns your own machine into a creator-owned station: it scans a local media vault, broadcasts a continuous HLS stream, serves a listener player, and provides a local creator dashboard for scheduling, uploads, access tokens, vault pricing, analytics, tips, and payment-backed unlocks.

It is built for one creator or a small trusted team running one station on Windows, macOS, Linux, or a 64-bit Raspberry Pi. It is not a multi-tenant SaaS platform. Windows, macOS, and desktop Linux (Ubuntu-class) install as a desktop app; headless Linux and Raspberry Pi install from source.

## What It Does

- Live internet radio from local audio/video files using FFmpeg and HLS.
- Live mic broadcast from the creator dashboard (go-live directly from the browser).
- Public library and archive browsing from `vault/`.
- Visibility controls: public, supporters-only, and vault.
- Listener accounts with password reset (via SMTP or creator-generated links), data export, and self-service deletion.
- Creator-issued access tokens and account token assignments.
- Stripe subscriptions, tips, and vault unlock checkout when configured — with listener self-service cancellation and Stripe billing portal.
- PayPal subscriptions with verified webhooks when configured.
- Creator dashboard for media, schedule, uploads, tokens, payments, and analytics.
- A daily **Today** brief that turns audience, release, revenue, and station-health data into explainable next actions.
- **Audience Memory** relationship timelines and useful cohorts such as returning listeners, buyers, inactive regulars, and gate visitors who did not purchase.
- **Release Autopilot** for scheduling track visibility, an announcement post, supporter notifications, feature placement, and an optional station premiere as one durable campaign.
- Consent-aware automations with recommendation and automatic modes, a delivery outbox, unsubscribe suppression, and an auditable explanation for every run.
- Listener polls, premiere reminders, and creator-moderated track requests through the player’s **Signal** panel.
- **Station Ops** health history plus optional automatic, checksum-verified local database backups.
- CSV exports (subscribers, listeners, download leads) and one-click hot database backups.
- Optional go-live / new-post announcements to a Discord-compatible webhook, and opt-in supporter email on new posts.
- Optional public RSS/podcast feed of public media at `/feed.xml`.
- Embeddable mini player at `/embed` for external websites.
- Optional TOTP 2FA on dashboard login.
- Desktop app for Windows, macOS, and Linux (Electron); convenience executable packaging for headless Linux/Raspberry Pi.

## Supported Platforms

| Platform | Public install path |
|---|---|
| Windows 10/11 x64 | Electron desktop app installer (`cd electron && npm run dist`) |
| macOS | Electron desktop app installer (`cd electron && npm run dist`) |
| Linux x64 desktop (Ubuntu-class) | Electron desktop app — AppImage/deb (`cd electron && npm run dist:linux`) |
| Linux x64 server/headless | `scripts/install.sh`, then `scripts/setup.sh` |
| Raspberry Pi 64-bit | `scripts/install.sh`, then `scripts/setup.sh` |

FFmpeg and ffprobe are bundled with every distribution (the Linux/Pi executable and
the Windows/macOS/Linux desktop app) — no separate install step is needed. If you're
instead running from source with `npm start`, install them yourself and make sure
they're on PATH; see `TROUBLESHOOTING.md`.

The Electron app isn't code-signed yet, so Windows SmartScreen / macOS Gatekeeper
will warn on first run — see [TROUBLESHOOTING.md](TROUBLESHOOTING.md). If you'd
rather run from source instead of using the desktop app, the same
`scripts/install.ps1` / `scripts/install-macos.sh` / `scripts/install.sh` +
`scripts/setup.sh` flow documented for Linux still works.

## Quick Start

Windows / macOS / Linux desktop (desktop app):

```bash
cd electron
npm ci
npm run dist         # Windows / macOS
npm run dist:linux   # Linux
```

Then run the installer produced in `electron/dist/` (NSIS `.exe` on Windows, `.dmg`
on macOS, `.AppImage` or `.deb` on Linux). The app walks you through setup on
first launch — no terminal needed after this.

Linux server / Raspberry Pi (from source):

```bash
bash scripts/install.sh
bash scripts/setup.sh
npm run preflight
npm start
```

Open:

```text
http://localhost:3000
```

Dashboard:

```text
http://localhost:3000/#dashboard
```

Use the dashboard token printed by `scripts/setup.sh`.

## Development

For live local testing from this checkout:

```bash
npm run dev
```

That starts the source server with backend restarts and browser live reload for
`client/` and `landing/` changes. To test the desktop wrapper without rebuilding
or reinstalling an app package:

```bash
npm run dev:desktop
```

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for details.

## Setup Guides

- Windows: [SETUP_WINDOWS.md](SETUP_WINDOWS.md)
- macOS: [SETUP_MACOS.md](SETUP_MACOS.md)
- Linux / Raspberry Pi: [SETUP_LINUX_PI.md](SETUP_LINUX_PI.md)
- Cloudflare Tunnel (public access): [CLOUDFLARE_SETUP.md](CLOUDFLARE_SETUP.md)
- Operations: [OPERATIONS.md](OPERATIONS.md)
- Security: [SECURITY.md](SECURITY.md)
- Troubleshooting: [TROUBLESHOOTING.md](TROUBLESHOOTING.md)
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
| `vault` | Paid unlock, scoped token, project unlock, track unlock, or enabled all-access |

The live broadcast playlist only uses public media. Gated media is served through library and download access checks.

## Release Checks

Before public distribution, run:

```bash
npm run release:check
```

That runs the clean/release checks, tests, preflight, migration checks, analytics checks, package asset checks, and production audit.

Convenience executable packaging for Linux/Raspberry Pi remains available:

```bash
npm run build:exe
```

By default this builds the native Linux executable for the current CPU. Linux
x64 and ARM64 hosts can build the other architecture explicitly with
`--target <linux-x64|linux-arm64> --allow-cross`, or both with
`--all --allow-cross`. Cross-builds require a published target-compatible
`better-sqlite3` prebuild. The
`Build Executables` GitHub Actions workflow builds and smoke-tests Linux x64
and Raspberry Pi/Linux ARM64 artifacts on matching hosted runners, and
separately builds the Windows/macOS/Linux Electron installers as a packaging check.

Desktop app packaging automatically selects the current OS:

```bash
cd electron && npm ci && npm run dist
```

The guarded `dist:win`, `dist:mac-universal`, and `dist:linux` commands remain
available when an explicit target command is useful.

## Project Layout

```text
client/
  creator.html          shipped player and creator dashboard
  index.html            optional landing/about page at /landing
src/
  api/                  Express API routes
  auth/                 listener tokens, tiers, access checks
  broadcast/            FFmpeg HLS engine, playlist, scheduler
  db/                   SQLite migrations and helpers
  events/               first-party audience and lifecycle events
  jobs/                 durable local background-job runner
  insights/             deterministic Today recommendations
  releases/             coordinated release campaigns
  automations/          consent-aware lifecycle recipes and delivery outbox
  ops/                  station checks and verified backups
  participation/        requests, polls, votes, and premiere reminders
  middleware/           CSRF and rate limit middleware
  scanner/              vault watcher, adapters, ffprobe metadata
  setup/                shared .env/folder provisioning (Electron wizard + setup.sh)
electron/               Windows/macOS/Linux desktop app (Electron + electron-builder)
scripts/
  install.ps1           Windows source-install (alternative to the desktop app)
  install-macos.sh      macOS source-install (alternative to the desktop app)
  install.sh            Linux / Pi installer
  setup.sh              interactive .env and folder setup
  build-exe.js          Linux/Pi convenience executable packaging
  preflight.js          release/runtime readiness check
  smoke.js              HTTP smoke test against a running server
```

Runtime data:

```text
.env
vault/
data/
logs/
hls_output/
```

## Current Limits

- One station owner or small trusted team.
- Dashboard auth is a shared owner token, not named team accounts.
- No listener email verification.
- Password reset emails require SMTP configuration; without it, the creator generates reset links from the dashboard.
- Payments require provider setup and verified webhooks.

## License

Copyright Paperweight Systems LLC. All rights reserved unless a separate license file says otherwise.
