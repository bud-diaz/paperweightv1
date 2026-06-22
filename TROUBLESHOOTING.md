# Troubleshooting

## FFmpeg Or ffprobe Not Found

Run:

```bash
ffmpeg -version
ffprobe -version
```

Install:

- Windows: `winget install Gyan.FFmpeg`
- macOS: `brew install ffmpeg`
- Linux/Pi: `sudo apt install ffmpeg`

Restart the terminal after installing, then run:

```bash
npm run preflight
```

## Port 3000 Is In Use

Either stop the other process or change `PORT` in `.env`.

Windows:

```powershell
netstat -ano | findstr :3000
```

macOS/Linux:

```bash
lsof -i :3000
```

## Dashboard Token Lost

Read it from `.env` on the machine running Paperweight:

```bash
grep DASHBOARD_TOKEN .env
```

On Windows PowerShell:

```powershell
Select-String DASHBOARD_TOKEN .env
```

## Stream Is Not Live

Check:

```bash
npm run preflight
```

Then verify:

- `vault/` contains supported media files.
- FFmpeg and ffprobe are on PATH.
- `/api/health` returns `status: ok`.
- `hls_output/stream/` is writable.

## Files Are Not Indexing

Supported extensions include `.mp3`, `.wav`, `.flac`, `.aac`, `.ogg`, `.m4a`, `.aiff`, `.opus`, `.mp4`, `.mov`, `.mkv`, `.avi`, `.webm`, and `.m4v`.

If a file uploads but does not appear, run:

```bash
ffprobe path/to/file
```

Paperweight rejects files that ffprobe cannot inspect.

## Payment Webhooks Do Not Update Access

Check `.env`:

- Stripe needs `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and the price IDs you use.
- PayPal needs `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, and `PAYPAL_WEBHOOK_ID`.

Open the dashboard webhook log and confirm provider events are arriving with `outcome: ok`.

## Windows Firewall Or SmartScreen

The Windows installer adds a firewall rule for port 3000. Verify:

```powershell
Get-NetFirewallRule -DisplayName "Paperweight"
```

The Electron desktop app and the Linux/Pi convenience executable are not
code-signed, so Windows SmartScreen may warn ("Windows protected your PC").
Click **More info -> Run anyway** to continue. Source installs avoid this
warning entirely.

## macOS Gatekeeper Blocks The App

The Electron desktop app is not notarized, so Gatekeeper may report it as
damaged or from an unidentified developer. Either:

- Right-click (or Control-click) the app and choose **Open**, then confirm
  in the dialog, or
- Open **System Settings -> Privacy & Security** and click **Open Anyway**
  next to the Paperweight warning.

This is a one-time step per install; it does not recur on subsequent launches.

## Raspberry Pi Runs Hot Or Slow

- Use a 64-bit OS.
- Use a heatsink or fan for video streaming.
- Prefer audio-only streams on Pi 4-class hardware.
- Verify HLS output is mounted as tmpfs:

```bash
mount | grep hls_output
```
