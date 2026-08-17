# Paperweight Mobile ("Paperweight: Play") — Scope Statement

**Status:** Scoping only — no implementation started.

## Context

Paperweight today ships as a self-hosted, single-tenant station: one Express
process per creator, with a web Studio SPA (`studio/`) covering both the
creator dashboard and the listener player, plus a separate Electron desktop
wrapper. There is no mobile client. Listeners and creators who want a phone
experience currently have none — the closest thing is the responsive web
Studio app and the standalone `landing/listen.html` cross-station search
page hosted outside any single station's own server.

This document scopes a new cross-platform mobile app, **"Paperweight:
Play,"** that gives listeners a native way to discover and play opted-in
creator stations, and gives creators a lightweight, QR-paired way to manage
their station from a phone.

## Decisions

| Area | Decision |
|---|---|
| Tech stack | React Native + Expo, single JS/TS codebase for iOS + Android |
| Discover data source | Live System.Pape hosted directory (`system.paperweighthq.com`), same API `landing/listen.html` already calls |
| Studio auth | Native Studio screens, backed by a **new bearer-token variant** of the existing device-pairing session (today's paired-device session is cookie-only) |
| Stash scope | On-device only, aggregating saves across whichever stations the listener has visited on that phone — no cross-device sync, no new backend |
| Studio v1 depth | Curated essentials (live/now-playing control, quick stats, release scheduling, notifications) **plus media upload** |
| Network settings | OS WiFi-settings deep link **and** an in-app manual station URL/LAN-IP override |
| Repo location | New `mobile/` workspace inside `paperweightv1`, same convention as `studio/` and `electron/` |
| Platforms | iOS + Android simultaneously via Expo |

## Existing building blocks

- **Cross-station discovery already exists, just not in-app.**
  `landing/listen.html` calls `GET
  https://system.paperweighthq.com/api/modules/paperweight/directory`
  (default listing) and `.../stations?q=&limit=` (search), documented in
  `docs/system-pape-contract.md` / `docs/system-pape-directory.md`.
  Individual station deployments have zero knowledge of each other; they
  only phone home via `src/telemetry/reporter.js`. Selecting a station in
  `listen.html` loads that station's own `/embed` iframe via its
  `publicUrl`. The mobile Discover tab reuses this exact pattern — call
  System.Pape directly, then hit the selected station's own API
  (`STATION_PUBLIC_URL`) for everything else.
  - **Dependency risk:** parts of the System.Pape contract (station
    self-registration) are documented as "Proposed," not confirmed live.
    Verify `/stations` and `/directory` are production-stable before
    building against them; `/embed`'s public reachability model already
    proves the read side works today.

- **How opt-in searchability works end to end (already built — no desktop
  backend changes needed for this part):** a creator flips
  `station_searchable` on via `PUT /api/dashboard/station/searchable`
  (`src/api/dashboard.js`), a desktop-only endpoint gated on a configured
  tunnel, a set public URL, and a live reachability check. That toggle is a
  local DB flag only. `src/telemetry/reporter.js`'s existing 5-minute
  heartbeat already includes `searchable: true/false` plus
  slug/name/`publicUrl` in its POST to System.Pape's `ingest` endpoint.
  System.Pape aggregates every station that's phoned home as searchable
  into `/stations` and `/directory`. Station **content** is never proxied
  through System.Pape — it stays served from each creator's own host,
  addressed by `publicUrl`. This whole chain already runs today to power
  `listen.html`, so Discover needs zero new backend work for
  opt-in/searchability itself.
  - **Real gap this surfaces:** `/embed` is a web iframe and isn't usable
    from a native app. Instead of loading `/embed`, the mobile app must
    call each selected station's own public API directly
    (library/structure, streaming, listener auth) using that station's
    `publicUrl` — the same listener endpoints `ListenerShell` already calls
    against "the" station, just re-pointed per station at runtime as the
    user switches stations in Discover. This is mobile-client work, not new
    backend surface: those listener endpoints already exist and already
    support bearer tokens (per CLAUDE.md's "Bearer token support for mobile
    clients").

- **Tab shell to mirror:** `studio/src/components/primitives.tsx`'s
  `ModeSwitcher` (pill tablist) and `studio/src/ListenerShell.tsx` /
  `AppShell.tsx` are the model for the native app's own
  Discover–Stack–Play–Studio pill nav, adding Discover as a 4th mode that
  doesn't exist in the web app today.

- **Stack tab split already exists conceptually:**
  `studio/src/views/StackView.tsx` splits into a **Stack** panel (current
  station's catalog, from `GET /api/library/structure`) and a **Stash**
  panel, backed by `studio/src/lib/hooks/useOfflineSaves.ts` — today this is
  browser-local IndexedDB scoped to one already-selected station. Mobile
  extends the same local-storage pattern (AsyncStorage / SQLite on-device)
  but keys stash entries by `(stationUrl, trackId)` so it naturally
  aggregates across every station the listener has saved from, matching the
  "across all stations" requirement without any backend change. Respect the
  existing `media.offline_allowed` per-track creator opt-in (migration 025)
  and the signed-URL `GET /api/library/:id/download` flow exactly as the
  web hook does.

- **Sticky transport to port natively:**
  `studio/src/components/StickyTransport.tsx` is the reference for the
  persistent mini-player — mounted outside the tab content in both shells,
  visible on Stack/Studio always and on Play once the in-view play button
  scrolls out of view. On mobile this becomes a persistent bottom bar across
  all four tabs, with the Play tab's "drawer" being a bottom-sheet that
  slides up over it to reveal the full player (`studio/src/views/PlayerView.tsx`
  is the content reference).

- **Device pairing flow to extend, not replace:**
  `src/auth/device-pairing.js` + `src/auth/devices.js` already implement
  QR-based pairing: an already-logged-in **desktop** Studio session
  (`studio/src/views/Security.tsx`) generates a QR
  (`POST /api/dashboard/devices/pair`), and the **scanning device** redeems
  it (`POST /api/auth/dashboard/device/redeem`, `src/api/auth.js`), which
  today returns only a `Set-Cookie: pw_dashboard_session`.
  `dashboard_devices` (migration 028) stores a SHA-256 hash of the session
  token with no `expires_at` — revoked only from the "Authorized Devices"
  panel in `Security.tsx`. The mobile app keeps this exact direction
  (desktop shows the QR, phone scans it) and reuses `dashboard_devices` for
  storage and the existing revocation UI — it does not add a new pairing
  mechanism.
  - `src/auth/middleware.js`'s `requireDashboard` currently validates
    paired devices via cookie only (`validateDeviceSession`); the only
    header-based fallback is the primary `X-Dashboard-Token`/`DASHBOARD_TOKEN`,
    not a per-device token, and it's disabled when 2FA is on. **New backend
    work required:** redeem must optionally return the raw device token as
    JSON (instead of/alongside `Set-Cookie`) when the redeeming client is
    the mobile app, and `requireDashboard` must accept
    `Authorization: Bearer <deviceToken>` hashed and looked up the same way
    `validateDeviceSession` does today.
  - Listener-side auth (Discover/Play/Stack) needs no new backend work —
    CLAUDE.md already documents bearer-token support for mobile clients on
    the listener `pw_token` path.

## Feature scope by tab (v1)

**Discover** (new — no direct web equivalent)
- Default listing + search-by-slug/name against the System.Pape directory.
- Selecting a station sets it as the app's "current station" (persisted
  locally, analogous to `useStationIdentity` in Studio) and drives Stack/Play.
- App settings modal: theme/misc app-level prefs, Network settings (OS WiFi
  deep link + manual station URL/LAN-IP override for stations only reachable
  on shared WiFi without a public tunnel).
- Account settings modal: listener account (email verification status,
  supporter tier, tipping identity) against the currently selected station's
  existing listener endpoints.

**Play**
- Simple player view with a slidable bottom-sheet drawer that opens upward
  to reveal the current Play tab's full content (mirrors `PlayerView.tsx`).
- Persistent sticky transport bar, visible on every other tab and whenever
  the drawer isn't fully open, matching `StickyTransport.tsx`'s behavior.

**Stack**
- Stack section: currently selected station's catalog
  (`GET /api/library/structure`), mirrors `StackView.tsx`'s library panel.
- Stash section: listener's on-device saved tracks aggregated across every
  station visited on that phone (see building-blocks section above).

**Studio** (QR-gated, curated essentials + upload for v1)
- Gate: not paired → prompt to scan a QR shown by an already-logged-in
  desktop Studio session; paired → native screens.
- v1 screens: live/now-playing control, quick stats, release scheduling,
  notifications, and media upload.
- Full parity with the other desktop-only sub-views (deep monetization
  config, full post editor, etc.) is explicitly deferred past v1.
- Device shows up in and is revocable from the existing "Authorized
  Devices" panel in web Studio (`Security.tsx`) — no separate revocation UI
  needed on mobile for v1 beyond a "sign out this device" action.

## Backend work required (new, beyond the mobile app itself)

1. Bearer-token variant of device-pairing redeem + `requireDashboard`
   support for `Authorization: Bearer <deviceToken>`, as described above.
   This is the one hard backend dependency the whole Studio tab rests on.
2. No changes needed for Discover (reads System.Pape directly, same as
   `landing/listen.html`, including the opt-in/searchability chain, which
   already runs today) or for Stack/Play/Stash (existing
   `library/structure`, `library/:id/download`, and listener bearer-token
   auth already cover it).
3. Media upload from Studio v1 should reuse whatever endpoint(s) the web
   Studio upload flow already uses — confirm at implementation time whether
   any size/streaming constraints need adjusting for mobile network
   conditions (not expected to need new endpoints, only client work).

## Non-goals for v1

- Full parity with all 13 desktop Studio sub-views.
- Cross-device sync of Stash (deliberately local-only per phone).
- A new backend-owned station directory (Discover depends on System.Pape).
- Any change to the existing web Studio pairing UI/flow — mobile is an
  additive scanning client, not a new pairing mechanism.
- Proxying station content through System.Pape — content stays served
  directly from each creator's own host.

## Repo / workspace structure

- New `mobile/` directory at repo root: its own isolated Expo/React Native
  workspace, same convention as `studio/` (isolated npm workspace, own
  dependency tree) and `electron/` (separate desktop packaging target). Not
  bundled into the `pkg`/`exe` build or `npm run build:exe`.
- No changes to `src/config.js`'s `isPackaged`/`isElectron` runtime split —
  mobile is a pure API client, not a new server runtime target.

## Open risks to confirm before/at implementation kickoff

- **System.Pape production readiness:** confirm `/stations` and
  `/directory` are live and stable (not just the "Proposed" registration
  spec) before committing Discover to depend on them.
- **QR pairing UX on a first-run phone with no desktop nearby:** today's
  flow requires an already-logged-in desktop session to originate the
  QR — worth confirming this bootstrap requirement is acceptable for
  mobile-only creators, or whether a documented workaround (dashboard on a
  phone browser first) is good enough for v1.
- **Media upload from mobile networks:** validate the existing upload
  endpoint's size limits/timeout behavior hold up on cellular before
  committing to it as-is.
- **CORS/network access from station hosts:** each station's public API
  needs to be reachable directly by the mobile app's HTTP client (not just
  by the `/embed` iframe path), which should already be the case for
  bearer-token listener endpoints but is worth a first-integration smoke
  test against a real tunnel-exposed station.

## Verification approach (once implementation begins)

- Backend bearer-token change: unit/HTTP test alongside existing
  `src/auth/devices.js` / `device-pairing.js` coverage in `npm test`, plus
  a manual pair-and-call-API round trip.
- Mobile app: run against a local Paperweight instance (`npm run dev`) for
  Stack/Play/Studio, and against the real System.Pape directory for
  Discover, on both an iOS simulator and an Android emulator via Expo.
- End-to-end pairing: pair a real/simulated device from a logged-in web
  Studio session, confirm the device appears in and is revocable from the
  "Authorized Devices" panel, and confirm revocation immediately breaks the
  mobile app's Studio access.
