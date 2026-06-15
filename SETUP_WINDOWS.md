# Paperweight Windows Setup

This guide installs Paperweight on Windows 10 or 11 for a self-hosted creator station.

## Requirements

- Windows 10 or 11, 64-bit.
- `winget` (App Installer from the Microsoft Store) — used by the installer to download Node.js and FFmpeg.
- Git for Windows, so you have Git Bash for `scripts/setup.sh`.
- Administrator access for the installer.
- Disk space for your media vault.

## Install

Open PowerShell as Administrator in the Paperweight folder:

```powershell
.\scripts\install.ps1
```

The installer installs or verifies Node.js, FFmpeg/ffprobe, PM2, and npm packages. It uses `winget` for Node.js and FFmpeg.

By default, Paperweight binds to `127.0.0.1` (localhost only). To open port 3000 for LAN access, pass `PAPERWEIGHT_OPEN_FIREWALL`:

```powershell
$env:PAPERWEIGHT_OPEN_FIREWALL="true"; .\scripts\install.ps1
```

Cloudflare Tunnel is optional. To install it too:

```powershell
$env:PAPERWEIGHT_INSTALL_CLOUDFLARED="true"; .\scripts\install.ps1
```

## Configure

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

Use the dashboard token printed by `scripts/setup.sh`.

## Keep It Running

```powershell
pm2 start ecosystem.config.js
pm2 save
pm2-windows-startup install
```

## Public Access

Use HTTPS when exposing a station publicly. Cloudflare Tunnel, Caddy, nginx, or another reverse proxy can sit in front of Paperweight. Set `STATION_PUBLIC_URL` and `HTTPS=true` in `.env` when public traffic uses TLS.

## Smoke Check

```bash
npm run release:check
npm run smoke
```

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for FFmpeg, firewall, dashboard token, and indexing issues.
