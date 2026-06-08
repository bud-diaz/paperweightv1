# Paperweight Linux / Raspberry Pi Setup

This guide installs Paperweight on Debian, Ubuntu, Raspberry Pi OS 64-bit, or an Ubuntu-based mini PC.

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

## Smoke Check

```bash
npm run release:check
npm run smoke
```
