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
