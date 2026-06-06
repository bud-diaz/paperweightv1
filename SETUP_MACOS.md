# Paperweight Setup — macOS

Self-hosted setup for macOS on Apple Silicon (M-series) or Intel. You will
install prerequisites with Homebrew, configure your station, and run it either
in the foreground or as a launch-on-login service.

## 1. Prerequisites

Paperweight needs **Node.js 18+** and **FFmpeg/ffprobe** on your `PATH`.

The installer script handles both via Homebrew (and installs Homebrew itself if
it is missing):

```bash
cd /path/to/paperweight
bash scripts/install-macos.sh
```

Optional flags:

- `--pm2` — also install PM2 for run-on-login (see step 5).
- `--cloudflared` — also install cloudflared to expose the station publicly.

To install prerequisites manually instead:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install node ffmpeg
```

Verify:

```bash
node --version     # v18 or newer
ffmpeg -version
ffprobe -version
```

## 2. Configure your station

```bash
bash scripts/setup.sh
```

This prompts for your station name, identity mode, vault path, and vault mode,
then writes `.env`, creates the runtime folders, and prints your **dashboard
token**. Save that token — it is required to open the creator dashboard.

`setup.sh` generates a permanent `DASHBOARD_TOKEN` and
`DOWNLOAD_SIGNING_SECRET` for you, so signed links and dashboard access survive
restarts.

## 3. Add media

Drop audio/video files into the vault folders created by setup (default
`./vault/music`, `./vault/podcasts`, `./vault/videos`, etc.). The scanner
indexes them automatically once the server is running.

## 4. Preflight and run

```bash
npm run preflight   # fails if FFmpeg/ffprobe are missing
npm start
```

- Station player: `http://localhost:3000`
- Dashboard: open the player and long-press the wordmark, then enter your
  dashboard token.

To let other devices on your network connect, allow incoming connections for
`node` when macOS prompts (System Settings → Network → Firewall), and visit
`http://<your-mac-ip>:3000` from another device.

## 5. Run on login (optional)

Foreground `npm start` stops when you close the terminal. For an always-on
station, use PM2:

```bash
npm install -g pm2          # or: bash scripts/install-macos.sh --pm2
pm2 start npm --name paperweight -- start
pm2 save
pm2 startup                 # run the command it prints to enable launch-on-login
```

Manage it with `pm2 status`, `pm2 logs paperweight`, and `pm2 restart
paperweight`.

## 6. Expose publicly (optional)

Paperweight runs fine on your LAN with no tunnel. To share it publicly without
opening a router port, use a Cloudflare Tunnel:

```bash
brew install cloudflared    # or: bash scripts/install-macos.sh --cloudflared
```

Follow the Cloudflare Zero Trust dashboard to create a tunnel to
`http://localhost:3000`. When you serve over HTTPS, set `HTTPS=true` in `.env`
so cookies use the `Secure` flag.

## Troubleshooting

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for FFmpeg-not-found, port-in-use,
lost dashboard token, stream-not-live, files-not-indexing, and payment-webhook
issues.
