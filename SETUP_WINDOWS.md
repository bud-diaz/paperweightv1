# Paperweight Windows Setup

This guide installs Paperweight on Windows 10 or 11 for a self-hosted creator station.

## Requirements

- Windows 10 or 11, 64-bit.
- Git for Windows, so you have Git Bash for `scripts/setup.sh`.
- Administrator access for the installer.
- Disk space for your media vault.

## Install

Open PowerShell as Administrator in the Paperweight folder:

```powershell
.\scripts\install.ps1
```

The installer installs or verifies Node.js, FFmpeg/ffprobe, PM2, npm packages, and a Windows firewall rule for port 3000.

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

> **Port note:** Paperweight uses port 3000 by default. If that port is already in use, it automatically selects the next available port (3001, 3002, …) and prints the actual URL on startup. Set `PORT=XXXX` in `.env` to choose a specific port.

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
