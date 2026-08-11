# Tailscale Setup (private remote access)

This guide covers reaching a self-hosted Paperweight station from your phone
or another device while away from home, over [Tailscale](https://tailscale.com)
instead of Cloudflare Tunnel.

Tailscale is a private WireGuard overlay network between your own devices.
Use this instead of [CLOUDFLARE_SETUP.md](CLOUDFLARE_SETUP.md) when you want
to reach your own station yourself — testing the dashboard from your phone,
checking a stream from outside the house — without making the station public.
It needs no domain, no Cloudflare account, no DNS zone, and no port
forwarding. The trade-off: only devices you've added to your tailnet can
reach the station, so it's not a fit if you want a public, shareable URL or
the `station_searchable` directory listing — use Cloudflare Tunnel for that.

## Prerequisites

- Paperweight installed and running (`npm start`, or the desktop app).
- A free [Tailscale account](https://login.tailscale.com/start).

## 1. Install Tailscale

On the machine running Paperweight:

```bash
# Linux
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

Windows/macOS: install from [tailscale.com/download](https://tailscale.com/download)
and sign in.

On your phone, install the Tailscale app (iOS/Android) and sign into the same
account. Both devices now share a private `100.x.y.z` address space and,
with MagicDNS enabled (on by default for new tailnets), a stable hostname
like `mymachine.tailXXXX.ts.net`.

## 2. Bind Paperweight to all interfaces

Set in `.env`:

```bash
HOST=0.0.0.0
```

This makes Paperweight listen on every network interface — your LAN and your
Tailscale interface — not just `127.0.0.1`. It does **not** expose the
station to the public internet by itself: nothing is port-forwarded on your
router, so it's only reachable by devices that can already route to the
machine (your LAN, and now your tailnet). Paperweight logs a reminder of this
at boot.

## 3. Set STATION_PUBLIC_URL to your Tailscale address

```bash
STATION_PUBLIC_URL=http://mymachine.tailXXXX.ts.net:3000
```

(Replace the hostname with your machine's actual MagicDNS name — find it in
the [Tailscale admin console](https://login.tailscale.com/admin/machines) or
by running `tailscale status` on the server. A raw `100.x.y.z` Tailscale IP
also works, but the MagicDNS name survives the address changing.)

This can also be set from the dashboard's **Station** panel instead of
editing `.env` directly. Once it's set, restart Paperweight. This is what
makes the mobile Studio pairing QR code, `feed.xml`, and share links resolve
to an address your phone can actually reach — without it, the pairing QR
falls back to a guessed LAN IP (or `localhost` if none is detected), which
only works if you're on the same Wi-Fi as the server.

### Optional: real HTTPS over Tailscale

Enable **HTTPS Certificates** for your tailnet in the Tailscale admin console
(DNS settings), then on the server:

```bash
tailscale cert mymachine.tailXXXX.ts.net
```

and set `STATION_PUBLIC_URL=https://mymachine.tailXXXX.ts.net:3000` with
`HTTPS=true` in `.env`, pointing Paperweight at the generated cert/key the
same way you would for any other HTTPS setup. Plain `http://` over Tailscale
is already encrypted at the WireGuard layer, so this step is cosmetic parity
with a public HTTPS deployment, not a security requirement.

## 4. Restart and pair your phone

```bash
npm run preflight
npm start
```

In the desktop dashboard, open **Authorized Devices** → **Pair a New
Device**, then scan the QR code with your phone — even while it's on
cellular data, off your home Wi-Fi, as long as Tailscale is connected on
both ends. The paired phone gets a full dashboard session, identical in
capability to the desktop session (uploads, broadcast controls, settings,
backups — everything).

## Known limitation: the "Reachable" health dot

Paperweight's SSRF guard (`src/runtime/net-guard.js`) refuses to
health-check or notify a URL that resolves to a private, loopback, or CGNAT
(`100.64.0.0/10`) address — the same range Tailscale itself uses. This means
the Station panel's reachability dot and the `station_searchable` toggle
will not go green over a Tailscale `STATION_PUBLIC_URL`, and outbound notify
webhooks won't fire for it either. This is a cosmetic/notification-only
limitation of those two specific checks — it does not affect dashboard
access, mobile pairing, or normal use of the station over Tailscale.

## Security Notes

- Your `DASHBOARD_TOKEN` (and 2FA, if enabled) still gate all dashboard
  access — Tailscale limits *who can reach the station at all*, it isn't a
  replacement for that login.
- Anyone you add to your tailnet (or an ACL-permitted node) can reach the
  station. Keep your tailnet's node list to devices you actually trust.
- Don't also port-forward the Paperweight port on your router alongside
  this setup — that would defeat the point of keeping it private.

See also: [CLOUDFLARE_SETUP.md](CLOUDFLARE_SETUP.md) if you later want a
public, shareable URL instead, and
[TROUBLESHOOTING.md](TROUBLESHOOTING.md) for other setup issues.
