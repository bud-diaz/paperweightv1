# Paperweight

Creator-owned streaming and direct media distribution, run on your own hardware.

Paperweight scans a local media vault, broadcasts a continuous HLS stream with FFmpeg, serves a listener player, and gives the creator a local dashboard for scheduling, uploads, tokens, listener accounts, vault pricing, analytics, and payments.

It is self-hosted and installs from source on **Windows, macOS, Linux, and Raspberry Pi (64-bit)**. It is built for a single creator (or a small owner-run team) running one station — it is not a multi-tenant SaaS platform, and there is no Paperweight cloud you depend on.

## What It Does

- Live broadcast from local audio/video files using FFmpeg and HLS.
- Listener web player with now-playing state and library browsing.
- Vault scanner that indexes files from `vault/`.
- Visibility controls: public, supporters-only, and vault.
- Listener accounts with email and password.
- Creator-issued access tokens and account token assignments.
- Stripe subscriptions, tips, and vault unlock checkout (optional).
- PayPal subscriptions with verified webhook handling when configured (optional).
- Creator dashboard for media, scheduling, uploads, tokens, payments, and analytics.

Packaged single-file executables (`@yao-pkg/pkg`) are an **experimental convenience**, not the primary distribution path — native SQLite and ARM make them brittle, so install from source on each platform below.

## Requirements (all platforms)

- Node.js 18 or newer.
- FFmpeg **and** ffprobe on `PATH` (external system dependency — not bundled).
- 2 GB RAM minimum, 4 GB recommended; disk space for your media vault.

## Quick Start by OS

The installer scripts handle prerequisites (Node LTS, FFmpeg, optional PM2).
After installing, `scripts/setup.sh` creates your `.env`, folders, and dashboard
token. cloudflared is optional on every platform — Paperweight runs on your LAN
without it.

**Linux / Raspberry Pi (64-bit, apt-based):**

```bash
bash scripts/install.sh        # add --cloudflared to expose publicly
bash scripts/setup.sh
npm run preflight
npm start
```

**macOS (Apple Silicon or Intel):**

```bash
bash scripts/install-macos.sh  # add --pm2 and/or --cloudflared
bash scripts/setup.sh
npm run preflight
npm start
```

**Windows (PowerShell as Administrator):**

```powershell
.\scripts\install.ps1          # add -Cloudflared to expose publicly
```

Then, in Git Bash:

```bash
bash scripts/setup.sh
npm run preflight
npm start
```

**Already have Node + FFmpeg?** Skip the installer:

```bash
npm install && bash scripts/setup.sh && npm run preflight && npm start
```

Station: `http://localhost:3000` — Dashboard: `http://localhost:3000/#dashboard`
(long-press the wordmark in the player). Use the dashboard token printed by
`scripts/setup.sh`.

## Setup Guides

- Linux / Raspberry Pi: [SETUP.md](SETUP.md)
- macOS: [SETUP_MACOS.md](SETUP_MACOS.md)
- Windows: [SETUP_WINDOWS.md](SETUP_WINDOWS.md)
- Troubleshooting: [TROUBLESHOOTING.md](TROUBLESHOOTING.md)
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

## Payments (optional)

Payments are off until you configure a provider, and they only work with verified webhooks:

- **Stripe** requires `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and at least one price ID. Without the webhook secret, subscription events are rejected and paid access is never granted.
- **PayPal** requires `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, and `PAYPAL_WEBHOOK_ID`. Without the webhook ID, events cannot be verified and access is not granted.

Paperweight prints loud startup warnings for partial or unverified payment config. See [SECURITY.md](SECURITY.md).

## Current Limitations

- Self-hosted only — no Paperweight cloud, mobile apps, plugin ecosystem, or station discovery are shipped today.
- Dashboard auth is a single shared **owner** token (`DASHBOARD_TOKEN`), not per-user team accounts.
- Listener accounts have no email verification and no password-reset flow.
- Packaged executables are experimental; install from source per OS above.
- FFmpeg/ffprobe must be installed separately on every platform.

## Release Checks

Run the full public-distribution gate before shipping:

```bash
npm run release:check    # npm test + migrations/scheduler/analytics/package checks
npm audit --omit=dev     # zero production vulnerabilities expected
```

`release:check` runs the test suite, then the migration, scheduler, analytics, and packaging/asset checks (the asset check fails if a shipped file is missing or the player reintroduces a CDN dependency). See [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md).

Building experimental executables (optional):

```bash
npm run build:exe
```

## Project Layout

```text
client/
  creator.html          single-file player and creator dashboard
  index.html            optional landing/about page at /landing
  vendor/               locally bundled frontend deps (hls.js — no CDN at runtime)
src/
  api/                  Express API routes
  auth/                 listener tokens, tiers, access checks
  broadcast/            FFmpeg HLS engine, playlist, scheduler
  db/                   SQLite migrations and helpers
  middleware/           CSRF and rate limit middleware
  scanner/              vault watcher, adapters, ffprobe metadata
scripts/
  install.sh            Linux/Raspberry Pi prerequisites (apt)
  install-macos.sh      macOS prerequisites (Homebrew)
  install.ps1           Windows prerequisites (winget)
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
