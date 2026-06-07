# Paperweight macOS Setup

This guide installs Paperweight on a Mac for a self-hosted creator station.

## Requirements

- macOS 13 or newer.
- Homebrew from https://brew.sh.
- Disk space for your media vault.

## Install

From the Paperweight folder:

```bash
bash scripts/install-macos.sh
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

For a simple local station, leave the terminal open. For a persistent station:

```bash
pm2 start src/index.js --name paperweight
pm2 save
```

To start PM2 automatically after login, follow PM2's macOS startup output:

```bash
pm2 startup
```

## Public Access

Use HTTPS when exposing a station publicly. Cloudflare Tunnel, Caddy, nginx, or another reverse proxy can sit in front of Paperweight. Set `STATION_PUBLIC_URL` and `HTTPS=true` in `.env` when public traffic uses TLS.

## Smoke Check

```bash
npm run release:check
npm run smoke
```
