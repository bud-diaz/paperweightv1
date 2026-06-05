# Paperweight

Self-hosted internet radio for creators. Run your own station from a Raspberry Pi, Windows PC, or any Linux machine — no cloud subscriptions, no middlemen.

---

## What it does

- **Live broadcast** — continuous HLS stream from your vault of audio and video files, with shuffle and scheduled programming modes
- **Listener player** — clean web player with waveform, now-playing card, and library drawer; works on desktop and mobile
- **Gated content** — set tracks or project bundles to Vault visibility with pay-what-you-want pricing; listeners unlock individually or by project
- **Listener accounts** — listeners create email + password accounts so their access follows them across devices
- **Tokens** — issue access tokens (subscriber, pro, all-access) and assign them directly to listener accounts
- **Projects** — organise tracks into named collections (albums, EPs, series) with their own pricing and unlock tokens
- **Dashboard** — creator control panel for library management, track metadata editing, scheduling, uploads, analytics, and payments

---

## Requirements

- **Node.js** 18+
- **FFmpeg** (audio/video processing and HLS broadcast)
- 2GB RAM minimum (4GB recommended)
- Disk space for your vault files

---

## Setup

- **Raspberry Pi / Linux** → see [SETUP.md](SETUP.md)
- **Windows** → see [SETUP_WINDOWS.md](SETUP_WINDOWS.md)

---

## Access tiers

| Tier | Access |
|---|---|
| `free` | Public tracks only |
| `subscriber` | Public + supporters-only tracks |
| `pro` | Everything in subscriber |
| `all_access` | All content including vault (if creator enables it) |

Listeners get a tier by: redeeming a creator-issued token, subscribing via Stripe, or having a token assigned directly to their account from the dashboard.

---

## Vault visibility levels

| Setting | Who can play |
|---|---|
| Public | Everyone |
| Supporters Only | Subscriber tier and above |
| Vault | Paid unlock or assigned token required |

---

## Development

```bash
npm install
npm run dev        # nodemon, auto-restarts on changes
```

Station runs at `http://localhost:3000`. Dashboard at `/#dashboard`.

---

## Project layout

```
vault/             ← your media files (music/, beats/, podcasts/, videos/, drafts/)
data/              ← SQLite database
hls_output/        ← live HLS segments (ephemeral)
src/
  api/             ← Express routes
  auth/            ← token validation, tier middleware
  broadcast/       ← FFmpeg engine, playlist, scheduler
  db/              ← migrations, SQLite helpers
  scanner/         ← vault file watcher
client/
  creator.html     ← entire frontend (single self-contained SPA)
scripts/           ← install, setup, preflight, token generator
```

---

## License

Paperweight Systems LLC
