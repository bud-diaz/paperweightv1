# system.pape Paperweight Directory

Paperweight stations report public directory eligibility through the existing telemetry ingest:

```http
POST https://system.paperweighthq.com/api/modules/paperweight/ingest
```

The telemetry payload includes:

```json
{
  "stationKey": "station-or-install-key",
  "slug": "station-slug",
  "name": "Station display name",
  "publicUrl": "https://station.example.com",
  "searchable": true
}
```

`name` comes from `STATION_NAME` and is used as the display name in public search results; consumers fall back to `slug` when it is absent.

`searchable` is read per report by the desktop app. When a creator turns searchability off, the next scheduled report, normally within about 5 minutes, sends `searchable:false` so system.pape can remove the station from the public directory.

## Public Search Endpoint

```http
GET https://system.paperweighthq.com/api/modules/paperweight/stations?q=<query>&limit=20
```

No authentication is required. The response is public read-only directory data, so system.pape should send:

```http
Access-Control-Allow-Origin: *
```

Successful response:

```json
{
  "stations": [
    {
      "slug": "rolling-woods-radio",
      "name": "Rolling Woods Radio",
      "url": "https://rolling-woods-radio.paperweighthq.com",
      "live": true,
      "listeners": 12,
      "nowPlaying": "Late Night Session, Vol. 3",
      "lastSeenAt": "2026-07-06T18:00:00.000Z"
    }
  ]
}
```

## Directory Semantics

Only list stations whose latest ingest has `searchable:true` and a fresh `lastSeenAt`.

Freshness should be approximately 15 minutes, which allows 2-3 missed 5-minute telemetry reports before a station is de-listed.

If the latest ingest has `searchable:false`, de-list the station even if it was previously searchable.

If `q` is empty, return top stations by listener count. If `q` is present, return matching stations, limited by `limit` with a default and maximum of 20.

Stations without a usable public URL or display identity should be omitted from public results.

## Telemetry Secret Registration (Self-Serve)

Historically every station authenticated its ingest reports with one shared secret (`PAPERWEIGHT_TELEMETRY_SECRET`, mirrored on the station as `PAPE_TELEMETRY_SECRET`). Because that single secret lives in every station's `.env`, anyone who holds it can forge ingest for any slug — hijack another station's vanity-URL redirect, forge listener/revenue numbers, or squat a slug before its rightful owner claims it. Self-serve registration replaces that with a per-station secret.

### Register endpoint

```http
POST https://system.paperweighthq.com/api/modules/paperweight/register
```

```json
{
  "slug": "rolling-woods-radio",
  "stationKey": "station-or-install-key",
  "secret": "station-generated-random-secret"
}
```

The station generates the `secret` locally (never sent to it by system.pape) and registers it. system.pape stores only a hash of the secret (scrypt — never plaintext), keyed to the station.

Ownership follows the same trust-on-first-use rule ingest already uses for slug claims:

- **Unclaimed slug** → store `{ slug, stationKey, secretHash }` and respond `200 { "ok": true }`.
- **Slug already claimed by the same `stationKey`** → overwrite the stored hash (secret rotation, e.g. after a reinstall) and respond `200`.
- **Slug claimed by a different `stationKey`** → `409 { "error": "slug already registered by another station" }`.

The `slug` is validated server-side with the same reserved-word/profanity rules Paperweight itself uses (`src/auth/reserved-slugs.js`); a malformed or reserved slug is rejected with `400`. Registration attempts are rate-limited per IP, because — unlike a bad ingest call, which only affects one station's own row — a rogue registration that wins the race can permanently deny a slug to its rightful owner.

### Ingest authentication

`POST /api/modules/paperweight/ingest` no longer compares `x-telemetry-secret` against the single global secret. It looks up the stored hash for the request's `stationKey` and verifies the presented secret against that hash.

The legacy shared secret is still accepted as a fallback for stations that have not re-registered yet — existing stations keep sending their old shared secret until they restart onto a freshly generated one, so this is a soft migration, not a hard cutover.
