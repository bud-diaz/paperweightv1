# System.Pape Integration Contract

This document is the working contract between Paperweight v1 (the self-hosted station app) and System.Pape (Paperweight Systems' internal control plane).

System.Pape owns the upstream API contract. Paperweight v1 owns the station/client implementation. Keep the two isolated: System.Pape auth, sessions, and Postgres data never move into Paperweight v1, and Paperweight v1 remains a self-hosted one-station product.

## Terminology Guardrail

| Term | Lives in | Means | Do not confuse with |
|---|---|---|---|
| **Paperweight station** | Paperweight v1 + System.Pape `pw_stations` | One self-hosted creator install broadcasting/reporting telemetry | System.Pape project |
| **System.Pape project** | System.Pape `projects` module | Internal company initiative/workstream with notes/tasks/decisions/repos | Paperweight creator collection |
| **Paperweight collection** | Paperweight v1 UI language | Creator-facing bundle/album/playlist-like grouping of tracks | System.Pape project |
| **Paperweight vault project** | Paperweight v1 legacy/internal DB names: `vault_projects`, `vault_project_items` | Historical implementation name for paid content groupings | Public-facing “project” wording |
| **Directory/search** | System.Pape Paperweight module | Public station discovery from opted-in telemetry | Creator content collection browsing |
| **Download analytics** | Landing page → Paperweight Vercel proxy → System.Pape | Public-site download events/leads | Station telemetry snapshots |
| **Telemetry ingest** | Paperweight station → System.Pape `/api/modules/paperweight/ingest` | Periodic station metrics, identity, listing eligibility | Download analytics |

Rule: code may keep legacy DB identifiers like `vault_projects`, but user-facing copy and new docs should call creator-facing groupings **collections** unless the context is explicitly technical/legacy.

## Base URL and Auth

Default hosted base URL:

```text
https://system.paperweighthq.com
```

Paperweight v1 may override this with `PAPE_URL` / `PAPERWEIGHT_ANALYTICS_BASE_URL` depending on the bridge.

Secrets:

- Telemetry and tunnel endpoints use `x-telemetry-secret`.
- Public download analytics endpoints use `x-analytics-secret` when System.Pape has `PAPERWEIGHT_ANALYTICS_SECRET` configured.
- Secrets are server-side only. Never expose telemetry or analytics secrets in `landing/download.html`, frontend bundles, screenshots, or logs.

## Station Identity

`stationKey` and `slug` are separate fields.

- `stationKey`: stable identity for the station install. Paperweight v1 sends `STATION_KEY` when set, else `STATION_SLUG`, else a generated `pwinst_...` install key.
- `slug`: globally unique public hostname identity, usually `<slug>.paperweighthq.com`.

They are often equal but are not aliases. A station may have a stable install key that differs from its public slug.

## Endpoint Contract

| Method + path | Auth | Paperweight v1 sends | System.Pape returns | Notes |
|---|---|---|---|---|
| `GET /api/health` | none | none | health JSON | Compatibility probe only. |
| `GET /api/modules/paperweight/slugs/validate?slug=<slug>` | none | query string | `{ valid: boolean, reason?: string }` | Uses System.Pape station slug rules. |
| `POST /api/modules/paperweight/register` | none today; rate-limited | `{ slug, stationKey, secret }` | `200 { ok: true }`, `400`, or `409` | Trust-on-first-use registration; stores a scrypt hash, never plaintext. |
| `POST /api/modules/paperweight/ingest` | `x-telemetry-secret` | telemetry payload below | `200 { ok: true }`, `401`, or `409` | Per-station secret with legacy shared-secret fallback. |
| `POST /api/modules/paperweight/frp/tunnel/create` | `x-telemetry-secret` | `{ stationKey, slug }` | `{ ok: true, provider: "frp", hostname, serverAddr, serverPort, authToken, proxyName, subdomain }` | Caller must own the slug. System.Pape stores only token hash. |
| `DELETE /api/modules/paperweight/frp/tunnel` | `x-telemetry-secret` | `{ stationKey, slug }` | `{ ok: true }`, `404`, or `409` | Clears System.Pape FRP tunnel fields for the owning station. |
| `POST /api/modules/paperweight/tunnel/create` | `x-telemetry-secret` | `{ stationKey, slug }` | `{ ok: true, tunnelToken, hostname }` | Cloudflare fallback/legacy managed tunnel flow. |
| `DELETE /api/modules/paperweight/tunnel` | `x-telemetry-secret` | `{ stationKey, slug }` | `{ ok: true }`, `404`, or `409` | Deletes managed Cloudflare tunnel/DNS when available. |
| `GET /api/modules/paperweight/stations?q=&limit=` | none | query string | `{ stations: [...] }` | Public station search for Paperweight app/landing pages. |
| `GET /api/modules/paperweight/directory` | none | none | `[{ slug, publicUrl, broadcasting, listeners, currentTrack }]` | Public directory list. Freshness must match search. |
| `POST /api/download-lead` | `x-analytics-secret` when configured | `{ email, platform?, updatesOptIn? }` | `{ ok: true, id, createdAt }` | Landing/download lead capture. |
| `POST /api/download-events` | `x-analytics-secret` when configured | `{ email?, platform, artifact?, version?, source?, medium?, campaign?, referrer? }` | `{ ok: true, id, createdAt }` | Landing/download click/event capture. |
| `GET /api/download-analytics/summary` | `x-analytics-secret` when configured | none | `{ ok: true, summary: ... }` | Internal summary endpoint; protect in production. |

## Telemetry Ingest Payload

Paperweight v1's `src/telemetry/reporter.js` sends:

```json
{
  "stationKey": "station-or-install-key",
  "slug": "rolling-woods-radio",
  "name": "Rolling Woods Radio",
  "publicUrl": "https://rolling-woods-radio.paperweighthq.com",
  "searchable": true,
  "version": "1.5.1",
  "platform": "linux",
  "listeners": 0,
  "uniqueListenersToday": 0,
  "totalTokens": 0,
  "subscribers": 0,
  "pro": 0,
  "allAccess": 0,
  "totalTracks": 0,
  "vaultTracks": 0,
  "broadcasting": false,
  "currentTrack": null,
  "grossCents": 0,
  "funnelMilestones": []
}
```

Current drift decision: `funnelMilestones` is intentionally treated as an ignored forward-compatible field by System.Pape until activation-funnel analytics are designed. It may be sent by Paperweight v1, but System.Pape does not persist it yet.

## Directory and Search Semantics

Only list stations that:

1. opted in with `searchable: true` on their latest report;
2. have a valid `slug`;
3. have a usable `publicUrl`;
4. reported recently.

Freshness target: 15 minutes for both `/stations` and `/directory`, allowing roughly 2-3 missed 5-minute telemetry reports before de-listing.

If a station sends `searchable:false`, System.Pape must de-index it on the next report.

## Download Analytics Semantics

The static download page must post same-origin to Paperweight's serverless proxy functions:

- `/api/download-lead`
- `/api/download-events`

Those functions forward to System.Pape and attach `X-Analytics-Secret` / `x-analytics-secret` from server-side environment only. The frontend must never contain the secret.

Valid normalized platforms are:

- `linux-x64`
- `linux-arm64`
- `windows-x64`
- `macos-arm64`
- `macos-x64`

Aliases like `win`, `windows`, `mac-arm64`, and `mac-x64` are normalized on the System.Pape side.

## Manual Cross-Repo QA Checklist

Before release or a tunnel/directory refactor is called done:

- [ ] A new Paperweight station can generate/register a telemetry secret.
- [ ] First ingest creates or updates a `pw_stations` row in System.Pape.
- [ ] `searchable:false` removes the station from `/stations` and `/directory` after the next report.
- [ ] `searchable:true` plus a reachable public URL makes the station appear in `/stations` and `/directory`.
- [ ] FRP one-click returns a hostname and Paperweight persists FRP config locally.
- [ ] Download page lead/event reaches System.Pape analytics summary.
- [ ] Public Paperweight UI copy says “collections” for creator content groupings unless the context is an explicit legacy/internal DB note.
- [ ] No dashboard/log output exposes telemetry or analytics secrets.
