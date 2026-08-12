# Paperweight FRP Tunnel Gateway

Paperweight-owned vanity URLs use a self-owned FRP gateway instead of a third-party hosted tunnel namespace.

## Public shape

- DNS: `*.paperweighthq.com -> <gateway VPS IP>`
- FRP control: `tunnel.paperweighthq.com:7000`
- Public HTTPS: `https://<slug>.paperweighthq.com`
- TLS termination: Caddy or Traefik on the gateway
- Internal FRP HTTP vhost: gateway-local `127.0.0.1:8080`

## DNS

```text
A tunnel.paperweighthq.com <VPS_IP>
A *.paperweighthq.com      <VPS_IP>
```

A wildcard CNAME is also acceptable if the DNS provider supports it:

```text
CNAME *.paperweighthq.com tunnel.paperweighthq.com
```

## `frps.toml`

```toml
bindPort = 7000
vhostHTTPPort = 8080
subDomainHost = "paperweighthq.com"

auth.method = "token"
auth.token = "${FRP_SERVER_TOKEN}"
```

## Generated station `frpc.toml`

Paperweight writes this under the station runtime root, normally `tunnel/frpc.toml`.

```toml
serverAddr = "tunnel.paperweighthq.com"
serverPort = 7000

auth.method = "token"
auth.token = "${FRP_STATION_TOKEN}"

[[proxies]]
name = "pw-${SLUG}-${STATION_SHORT_ID}"
type = "http"
localIP = "127.0.0.1"
localPort = 3000
subdomain = "${SLUG}"
```

## Security rules

- Stations never receive gateway admin credentials.
- Slug ownership is decided by System.Pape before FRP config is issued.
- Reserved/admin slugs are blocked by the same slug validator used for telemetry registration.
- Only the stationKey that owns a slug can request that slug's tunnel config.
- FRP tokens/config files are treated as secrets: never log them, never show them in browser UI.

## Production caveat

Plain FRP token auth is coarse. For production multi-station use, the gateway needs station-scoped authorization, such as an FRP server plugin/hook that validates `(proxyName, subdomain, token)` against System.Pape or an equivalent gateway-side policy layer. Until that is in place, treat FRP as staging/private-beta infrastructure.
