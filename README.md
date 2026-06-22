# Paperweight

Self-hosted, creator-first streaming and distribution.

Paperweight turns your own machine into a creator-owned station: it scans a local media vault, broadcasts a continuous HLS stream, serves a listener player, and provides a local creator dashboard for scheduling, uploads, access tokens, vault pricing, analytics, tips, and payment-backed unlocks.

It is built for one creator or a small trusted team running one station on Windows, macOS, Linux, or a 64-bit Raspberry Pi. It is not a multi-tenant SaaS platform. Windows and macOS install as a desktop app; Linux and Raspberry Pi install from source.

## What It Does

- Live internet radio from local audio/video files using FFmpeg and HLS.
- Live mic broadcast from the creator dashboard (go-live directly from the browser).
- Public library and archive browsing from `vault/`.
- Visibility controls: public, supporters-only, and vault.
- Listener accounts, creator-issued access tokens, and account token assignments.
- Stripe subscriptions, tips, and vault unlock checkout when configured.
- PayPal subscriptions with verified webhooks when configured.
- Creator dashboard for media, schedule, uploads, tokens, payments, and analytics.
- Optional TOTP 2FA on dashboard login.
- Desktop app for Windows and macOS (Electron); convenience executable packaging for Linux/Raspberry Pi.

## Supported Platforms

| Platform | Public install path |
|---|---|
| Windows 10/11 x64 | Electron desktop app installer (`cd electron && npm run dist`) |
| macOS | Electron desktop app installer (`cd electron && npm run dist`) |
| Linux x64 | `scripts/install.sh`, then `scripts/setup.sh` |
| Raspberry Pi 64-bit | `scripts/install.sh`, then `scripts/setup.sh` |

FFmpeg and ffprobe are required on every platform. The Linux/Pi installers verify
or install them; the desktop app's setup wizard checks for them on first run.

The Electron app isn't code-signed yet, so Windows SmartScreen / macOS Gatekeeper
will warn on first run — see [TROUBLESHOOTING.md](TROUBLESHOOTING.md). If you'd
rather run from source on Windows or macOS instead of using the desktop app, the
same `scripts/install.ps1` / `scripts/install-macos.sh` + `scripts/setup.sh` flow
documented for Linux still works.

## Quick Start

Windows / macOS (desktop app):

```bash
cd electron
npm ci
npm run dist
```

Then run the installer produced in `electron/dist/` (NSIS `.exe` on Windows, `.dmg`
on macOS). The app walks you through setup on first launch — no terminal needed
after this.

Linux / Raspberry Pi:

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

## Setup Guides

- Windows: [SETUP_WINDOWS.md](SETUP_WINDOWS.md)
- macOS: [SETUP_MACOS.md](SETUP_MACOS.md)
- Linux / Raspberry Pi: [SETUP_LINUX_PI.md](SETUP_LINUX_PI.md)
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

By default this builds the native executable for the current OS/CPU. The
`Build Executables` GitHub Actions workflow builds and smoke-tests Linux x64
and Raspberry Pi/Linux ARM64 artifacts on matching hosted runners, and
separately builds the Windows/macOS Electron installers as a packaging check.

Windows and macOS desktop app packaging:

```bash
cd electron && npm ci && npm run dist
```

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
  middleware/           CSRF and rate limit middleware
  scanner/              vault watcher, adapters, ffprobe metadata
  setup/                shared .env/folder provisioning (Electron wizard + setup.sh)
electron/               Windows/macOS desktop app (Electron + electron-builder)
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
- No listener password reset flow.
- Payments require provider setup and verified webhooks.
- FFmpeg/ffprobe remain external system dependencies.

## License

Copyright Paperweight Systems LLC. All rights reserved unless a separate license file says otherwise.
