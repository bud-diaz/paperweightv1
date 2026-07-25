# Cloudflare Tunnel Setup

This guide covers exposing a self-hosted Paperweight station to the public
internet with Cloudflare Tunnel — no port forwarding, no exposed home IP, and
free HTTPS. It's the recommended way to make a station reachable outside your
LAN, and it's a requirement if you want the station to opt into the public
directory (`station_searchable`).

If you're only running Paperweight locally for yourself, you can skip this
entirely — see [SETUP_WINDOWS.md](SETUP_WINDOWS.md),
[SETUP_MACOS.md](SETUP_MACOS.md), or [SETUP_LINUX_PI.md](SETUP_LINUX_PI.md).

**For maintainers:** this repo registers Cloudflare's MCP server
(`.mcp.json`) for Claude Code sessions, so tunnels and DNS records can be
created/inspected via chat during development instead of the Zero Trust
dashboard. That's a dev-tooling convenience only — it's unrelated to
anything shipped to end users; see "1a. Or: let the dashboard create the
tunnel for you" below for the actual product feature.

## Three Ways To Tunnel

| | Quick Tunnel | Named Tunnel (own domain) | Hosted on paperweighthq.com |
|---|---|---|---|
| Cloudflare account | Not required | Free account required | Not required |
| Your own domain | Not required | Required | Not required |
| URL | Random `*.trycloudflare.com`, changes every restart | Stable subdomain you choose, e.g. `radio.yoursite.com` | Stable `<slug>.paperweighthq.com` |
| `CLOUDFLARE_TUNNEL_TOKEN` | None — searchability requirements stay unmet | Set in `.env` | Set in `.env` (issued by system.pape) |
| Runs as a background service | No, ties to the terminal | Yes | Yes |
| Good for | Quickly testing that public access works | Running a real station long-term with your own domain | Running a real station without buying a domain |

Use a Quick Tunnel to confirm things work, then move to a Named Tunnel or the
paperweighthq.com-hosted option before telling anyone the URL.

## Prerequisites

- Paperweight installed and running locally (`npm start`, or the desktop app).
- For a Named Tunnel: a free [Cloudflare account](https://dash.cloudflare.com/sign-up)
  and a domain added to it (Cloudflare offers free domain registration and
  also accepts domains registered elsewhere — just point its nameservers at
  Cloudflare).

## Installing `cloudflared`

Paperweight's installer scripts can install `cloudflared` for you:

```bash
# Linux / Raspberry Pi
PAPERWEIGHT_INSTALL_CLOUDFLARED=true bash scripts/install.sh

# Windows (PowerShell, as Administrator)
$env:PAPERWEIGHT_INSTALL_CLOUDFLARED="true"; .\scripts\install.ps1
```

On macOS, install it with Homebrew:

```bash
brew install cloudflared
```

Verify it's on your PATH:

```bash
cloudflared --version
```

## Path A: Quick Tunnel (fastest, for testing)

No Cloudflare account needed. Run this alongside `npm start`:

```bash
cloudflared tunnel --url http://localhost:3000
```

`cloudflared` prints a random `https://<random-words>.trycloudflare.com` URL.
Set that as your `STATION_PUBLIC_URL` in `.env` and set `HTTPS=true`, then
restart Paperweight:

```bash
STATION_PUBLIC_URL=https://<random-words>.trycloudflare.com
HTTPS=true
```

Limitations: the URL changes every time you restart `cloudflared`, and there's
no tunnel token, so `CLOUDFLARE_TUNNEL_TOKEN` stays empty — the dashboard's
"searchable" directory toggle will stay disabled (it requires a token). Quick
Tunnels are for confirming public reachability works, not for a station you
want to keep online.

## Path B: Named Tunnel (recommended)

### 1. Create the tunnel in Cloudflare

1. Open the [Zero Trust dashboard](https://one.dash.cloudflare.com) →
   **Networks → Tunnels → Create a tunnel**.
2. Choose **Cloudflared** as the connector type and name it (e.g. `paperweight`).
3. Cloudflare shows an install command containing a long token. Copy just the
   token value — you'll paste it into Paperweight's `.env`, not run the
   install command as-is (Paperweight's own setup manages the token for you).
4. Under **Public Hostname**, add a hostname on a domain in your Cloudflare
   account (e.g. `radio.yoursite.com`), pointing at:
   - Type: `HTTP`
   - URL: `localhost:3000` (or whatever `PORT` Paperweight is running on)

   Do **not** add a public hostname for the RTMP ingest port
   (`RTMP_INGEST_PORT`, default `1935`). That's for local/LAN encoders only
   (e.g. OBS) and must never be reachable from the internet.

### 1a. Or: let the dashboard create the tunnel for you

Instead of steps above, the dashboard's **Station** panel can create the
tunnel and DNS record for you via Cloudflare's API:

1. Generate a Cloudflare API Token at
   [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens)
   scoped with **Cloudflare Tunnel: Edit** and **DNS: Edit** permissions. This
   is a different token from the tunnel connector token described above —
   don't confuse the two, and treat it as equally sensitive.
2. In the dashboard's Station panel, paste it into **Cloudflare Tunnel
   (optional)** and click **Save**.
3. Pick a zone (domain) from the dropdown, enter the hostname you want (e.g.
   `radio.yoursite.com`), and click **Create Tunnel**.
4. The dashboard creates the tunnel, points its ingress at this Paperweight
   instance, creates the DNS CNAME, and saves the resulting
   `CLOUDFLARE_TUNNEL_TOKEN` and `STATION_PUBLIC_URL` for you.

This is entirely optional — `CLOUDFLARE_TUNNEL_TOKEN` works exactly the same
whether it was pasted in by hand or created this way. You still need to run
`cloudflared` as a background service afterward — see step 3 below — this
flow only replaces the manual dashboard clicking in step 1, not
`cloudflared` itself.

### 2. Configure Paperweight

Run `bash scripts/setup.sh` (or `scripts/setup.ps1` equivalent flow) and paste
the token when prompted, or edit `.env` directly:

```bash
CLOUDFLARE_TUNNEL_TOKEN=<paste the token from the Cloudflare dashboard>
STATION_PUBLIC_URL=https://radio.yoursite.com
HTTPS=true
TRUST_PROXY=loopback
```

`TRUST_PROXY=loopback` is set automatically by `scripts/setup.sh` and the
Electron setup wizard whenever a tunnel token is present — traffic arrives at
Paperweight from `cloudflared` on localhost, so Paperweight needs to trust
that hop to see the real client IP.

If your station has a `STATION_SLUG`, `STATION_PUBLIC_URL` must be the
tunnel's actual address — never set it to
`https://<slug>.paperweighthq.com` itself. That vanity URL redirects to
whatever `STATION_PUBLIC_URL` holds, so pointing it at itself creates a
redirect loop.

### 3. Run `cloudflared` as a background service

A Named Tunnel needs `cloudflared` running continuously, independent of your
terminal session.

**Linux (systemd):**

```bash
sudo cloudflared service install <token>
sudo systemctl enable --now cloudflared
```

**Windows:**

```powershell
cloudflared service install <token>
```

This registers it as a Windows service that starts on boot.

**macOS:**

```bash
sudo cloudflared service install <token>
```

**Desktop app (Electron):** paste the tunnel token into the setup wizard's
"Cloudflare tunnel token" field (or the dashboard's Station panel later).
This does *not* run or supervise `cloudflared` for you — you still need to
install it and run `cloudflared service install <token>` as shown above, same
as any other platform. The wizard/dashboard only manage the token value.

### 4. Restart and verify

```bash
npm run preflight
npm start
```

Open the dashboard's **Station** panel:

- The health dot should turn green ("Reachable · Nms") once
  `STATION_PUBLIC_URL` resolves and responds.
- The "searchable" toggle becomes available once both a tunnel token
  (`CLOUDFLARE_TUNNEL_TOKEN`) and a registered public URL are present, and it
  actually flips on only after a live reachability check succeeds.

## Path C: Hosted On paperweighthq.com (no domain needed)

If you don't own a domain and don't want to buy one, the dashboard can get
you a Named Tunnel on `<slug>.paperweighthq.com` instead — same stable-URL,
runs-as-a-service tunnel as Path B, provisioned for you by system.pape
instead of your own Cloudflare account.

1. Claim a station slug and register with system.pape telemetry (dashboard's
   **Station** panel → **SYSTEM.PAPE TELEMETRY** → **REGISTER**) if you
   haven't already — this is also what makes the public directory listing
   work.
2. In the **PAPERWEIGHTHQ.COM TUNNEL** section that appears once telemetry is
   registered, click **GET FREE ADDRESS**. The dashboard asks system.pape to
   create the tunnel and DNS record, then saves the resulting
   `CLOUDFLARE_TUNNEL_TOKEN` and `STATION_PUBLIC_URL`
   (`https://<slug>.paperweighthq.com`) for you, the same way Path B's
   "auto-tunnel" button does for your own domain.
3. Run `cloudflared` as a background service with that token — same step 3 as
   Path B.
4. Restart and verify — same step 4 as Path B.

Unlike Path B, there's no per-creator Cloudflare account or API token
involved: the `paperweighthq.com` zone and its Cloudflare credentials are
held by system.pape, not by your station. See
`docs/system-pape-directory.md` ("Hosted Tunnel Provisioning") for that
contract.

## Security Notes

- **RTMP ingest stays local.** `RTMP_INGEST_HOST`/`RTMP_INGEST_PORT` are for
  local/LAN encoders (OBS) only. Never add a Cloudflare public hostname for
  that port — the stream key shown in the dashboard is a UX convenience, not
  real access control.
- **The public URL must actually be public.** Paperweight's SSRF guard
  (`src/runtime/net-guard.js`) refuses to health-check or notify a URL that
  resolves to loopback, private, link-local, or CGNAT ranges. Pointing
  `STATION_PUBLIC_URL` at `localhost` or a LAN IP will fail closed by design —
  it must be the tunnel/reverse-proxy hostname that resolves publicly.
- **Treat the tunnel token as a secret.** It's equivalent to a credential that
  can bind a connector to your Cloudflare account. Don't commit `.env` or
  paste the token into logs or screenshots.
- Cloudflare Tunnel replaces the need for port forwarding or opening firewall
  ports on your router — keep your router's inbound ports closed and let the
  tunnel be the only path in.

## Troubleshooting

**Health check stays "Unreachable".**
Confirm `cloudflared` is actually running (`systemctl status cloudflared` on
Linux, or check the service on Windows/macOS) and that the Public Hostname in
the Cloudflare dashboard points at the correct local port. DNS for a newly
created hostname can take a minute or two to propagate.

**Searchable toggle stays disabled.**
It requires both a non-empty `CLOUDFLARE_TUNNEL_TOKEN` in `.env` and a
registered public URL (`STATION_PUBLIC_URL` or a claimed station URL). Check
`GET /api/dashboard/station` in the dashboard network tab for which
requirement is unmet.

**Cloudflare shows the tunnel as "Down" in the dashboard.**
The `cloudflared` service isn't running or lost its connection. Restart the
service; check its logs (`journalctl -u cloudflared` on Linux) for connection
errors.

**Quick Tunnel URL keeps changing.**
That's expected — Quick Tunnels are ephemeral. Move to a Named Tunnel (Path B)
for a URL that survives restarts.

**Rotating or revoking a token.**
Delete the old service (`cloudflared service uninstall`), revoke/delete the
tunnel in the Zero Trust dashboard if you're retiring it, generate a new
token if reusing the tunnel, update `CLOUDFLARE_TUNNEL_TOKEN` in `.env`, and
restart both `cloudflared` and Paperweight.

See also: [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for other setup issues,
and [SETUP_WINDOWS.md](SETUP_WINDOWS.md) / [SETUP_MACOS.md](SETUP_MACOS.md) /
[SETUP_LINUX_PI.md](SETUP_LINUX_PI.md) for full platform install guides.
