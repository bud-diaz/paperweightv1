# Troubleshooting

Common problems and fixes, grouped by symptom. Run `npm run preflight` first —
it diagnoses most setup issues (Node version, `.env`, dependencies, FFmpeg,
ports, payment config) and prints platform-specific remediation.

## FFmpeg / ffprobe not found

The broadcast engine and the vault scanner both shell out to FFmpeg. If
`npm run preflight` reports `ffmpeg`/`ffprobe` missing:

- **Linux / Raspberry Pi:** `sudo apt install ffmpeg`
- **macOS:** `brew install ffmpeg`
- **Windows:** `winget install Gyan.FFmpeg`, then **open a new terminal** so
  `PATH` refreshes.

Confirm both binaries resolve: `ffmpeg -version` and `ffprobe -version`. Both
are required — some minimal builds ship `ffmpeg` without `ffprobe`.

## Port already in use

`Port 3000 is already in use` at startup means another process holds the port.

- Find it: `lsof -i :3000` (macOS/Linux) or `netstat -ano | findstr :3000`
  (Windows).
- Stop that process, or change `PORT` in `.env` and restart.

## Dashboard token lost

The dashboard is gated by `DASHBOARD_TOKEN` in `.env`.

- Look in your `.env` file — `setup.sh` wrote it there and printed it once.
- If `DASHBOARD_TOKEN` is unset, the server generates a **temporary** token on
  each start and prints it to the console (and warns you at startup). Set a
  permanent value in `.env` to stop it changing every restart.
- The dashboard token is held in the browser's `sessionStorage` only, so it is
  cleared when you close the tab — re-enter it after long-pressing the wordmark.

## Stream is not live

The player shows nothing playing, or `state.json` is empty.

- The vault must contain at least one **probeable** media file. An empty vault
  logs `Vault has no playable media — waiting...`.
- Newly uploaded files are not playable until the scanner runs `ffprobe` on
  them successfully (see below). Corrupt or unsupported files never go live.
- Check `logs/` and the console for FFmpeg errors. Make sure
  `hls_output/stream/` exists and is writable.

## Files are not indexing

You added files but they do not appear in the library.

- The scanner only indexes supported audio/video extensions placed **inside**
  the vault category folders (`music`, `beats`, `podcasts`, `videos`, `drafts`,
  `live_sessions`).
- Indexing requires a successful `ffprobe`. If a file is corrupt or an
  unexpected format, it stays inactive and hidden — check the console for a
  `ffprobe exited` error for that path.
- Dashboard uploads are written as inactive until probed, so there is a brief
  delay between upload and the track appearing.

## Payment webhooks not updating access

A listener paid but did not get access.

- Paid access is granted by **webhooks**, not the checkout redirect. Verify the
  provider is fully configured:
  - Stripe needs `STRIPE_SECRET_KEY` **and** `STRIPE_WEBHOOK_SECRET`.
  - PayPal needs `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, **and**
    `PAYPAL_WEBHOOK_ID`.
- Without the webhook secret/ID, events are rejected — the server warns about
  this at startup.
- The webhook endpoint must be reachable from the provider (a public URL or
  tunnel). Inspect delivered events in the dashboard's webhook log; duplicate
  deliveries are deduplicated and acknowledged, so a `duplicate` outcome is
  normal.

## Windows: firewall or SmartScreen

- **Firewall:** `install.ps1` adds an inbound rule for port 3000. If you skipped
  it, allow `node` through Windows Defender Firewall, or re-run the installer.
- **SmartScreen** may warn on an experimental packaged `.exe`. Prefer running
  from source (`npm start`); executables are a convenience, not the supported
  path.

## Raspberry Pi: overheating or SD-card wear

- `scripts/install.sh` mounts `hls_output/` as **tmpfs** so HLS segments are
  written to RAM, not the SD card. Keep that mount — constant segment writes
  wear out SD cards quickly.
- For 24/7 stations, use a heatsink/fan and a quality power supply. Throttling
  under load can cause FFmpeg stutters.
- Use 64-bit Raspberry Pi OS (or Ubuntu) — `better-sqlite3` and FFmpeg are most
  reliable there.

## Still stuck?

Run `npm run preflight` and `npm test`, and check `logs/`. When sharing logs,
redact dashboard tokens, payment secrets, listener tokens, and tunnel tokens
(see [SECURITY.md](SECURITY.md)).
