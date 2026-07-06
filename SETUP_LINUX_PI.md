# Paperweight Linux / Raspberry Pi Setup

This guide installs Paperweight from source on Debian, Ubuntu, Raspberry Pi OS 64-bit, or an Ubuntu-based mini PC.

> **Running a desktop?** If your Linux machine has a graphical desktop (Ubuntu
> Desktop and similar), you can use the Paperweight desktop app instead of a
> source install: build or download the AppImage/`.deb`
> (`cd electron && npm ci && npm run dist:linux`), install FFmpeg
> (`sudo apt-get install -y ffmpeg`), and launch the app — it walks you through
> setup graphically, no terminal needed afterwards. The rest of this guide
> covers the source install, which is the right choice for servers, headless
> boxes, and Raspberry Pi.

## Requirements

- Debian/Ubuntu/Raspberry Pi OS 64-bit.
- 2 GB RAM minimum, 4 GB recommended.
- Disk space for your media vault.
- A heatsink or fan is recommended for Raspberry Pi stations that stream video.

## Install

From the Paperweight folder:

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

> **Port note:** Paperweight uses port 3000 by default. If that port is already in use, it automatically selects the next available port (3001, 3002, …) and prints the actual URL on startup. Set `PORT=XXXX` in `.env` to choose a specific port.

Use the dashboard token printed by `scripts/setup.sh`.

## Raspberry Pi Notes

The installer mounts `hls_output/` as tmpfs to reduce SD-card writes from HLS segment churn.

Verify:

```bash
mount | grep hls_output
```

## Keep It Running

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

PM2 prints a platform-specific command. Run that command exactly so Paperweight starts after reboot.

## Optional Cloudflare Tunnel

Cloudflare Tunnel is not installed by default. To install it with the Linux/Pi installer:

```bash
PAPERWEIGHT_INSTALL_CLOUDFLARED=true bash scripts/install.sh
```

Set `STATION_PUBLIC_URL` and `HTTPS=true` when public traffic is served over TLS.

If your station has a `STATION_SLUG`, set `STATION_PUBLIC_URL` to your station's actual server address — the tunnel, reverse-proxy, or public IP URL where listeners can reach it (e.g., `https://your-tunnel.trycloudflare.com` or `https://mystation.example.com`). This is what `<slug>.paperweighthq.com` redirects visitors to. Do not set it to `https://<slug>.paperweighthq.com` itself — that creates a redirect loop.

## Smoke Check

```bash
npm run release:check
npm run smoke
```
