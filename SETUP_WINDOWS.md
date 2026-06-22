# Paperweight Windows Setup

This guide installs Paperweight on Windows 10 or 11 for a self-hosted creator station.

## Desktop App (Recommended)

Build (or download, if a release is published) the Electron desktop app and run
the installer — it includes a graphical setup wizard, a system tray icon with
"Launch at Login", and keeps the station running without a terminal window:

```bash
cd electron
npm ci
npm run dist
```

Run the generated installer from `electron\dist\*.exe`, which creates Desktop
and Start Menu shortcuts. The app isn't code-signed yet, so Windows SmartScreen
will warn the first time — click **More info -> Run anyway**. See
[TROUBLESHOOTING.md](TROUBLESHOOTING.md) for details.

The rest of this guide covers the alternative: running Paperweight from source
with a terminal and PM2.

## Advanced: Install From Source

- Windows 10 or 11, 64-bit.
- Git for Windows, so you have Git Bash for `scripts/setup.sh`.
- Administrator access for the installer.
- Disk space for your media vault.

### Install

Open PowerShell as Administrator in the Paperweight folder:

```powershell
.\scripts\install.ps1
```

The installer installs or verifies Node.js, FFmpeg/ffprobe, PM2, npm packages, and a Windows firewall rule for port 3000.

Cloudflare Tunnel is optional. To install it too:

```powershell
$env:PAPERWEIGHT_INSTALL_CLOUDFLARED="true"; .\scripts\install.ps1
```

### Configure

Open Git Bash in the Paperweight folder:

```bash
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

> **Port note:** Paperweight uses port 3000 by default. If that port is already in use, it automatically selects the next available port (3001, 3002, …) and prints the actual URL on startup. Set `PORT=XXXX` in `.env` to choose a specific port.

Use the dashboard token printed by `scripts/setup.sh`.

### Keep It Running

```powershell
pm2 start ecosystem.config.js
pm2 save
pm2-windows-startup install
```

### Public Access

Use HTTPS when exposing a station publicly. Cloudflare Tunnel, Caddy, nginx, or another reverse proxy can sit in front of Paperweight. Set `STATION_PUBLIC_URL` and `HTTPS=true` in `.env` when public traffic uses TLS.

If your station has a `STATION_SLUG`, set `STATION_PUBLIC_URL` to your station's actual server address — the tunnel, reverse-proxy, or public IP URL where listeners can reach it (e.g., `https://your-tunnel.trycloudflare.com` or `https://mystation.example.com`). This is what `<slug>.paperweighthq.com` redirects visitors to. Do not set it to `https://<slug>.paperweighthq.com` itself — that creates a redirect loop.

### Smoke Check

```bash
npm run release:check
npm run smoke
```

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for FFmpeg, firewall, dashboard token, and indexing issues.
