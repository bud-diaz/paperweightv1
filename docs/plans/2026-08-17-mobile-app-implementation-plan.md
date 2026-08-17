# Paperweight Mobile — Implementation Plan

**Status:** Approved. Phase 0 in progress.

## Context

`docs/plans/2026-08-17-mobile-app-scope.md` scopes a new React Native + Expo
mobile app, "Paperweight: Play," as a `mobile/` workspace in this repo: a
4-tab app (Discover, Play, Stack, Studio) that lets listeners find and play
opted-in creator stations and lets creators manage their station from a
QR-paired phone. This document turns that scope into a phased, executable
build order, grounded in the actual files/functions that already exist and
the ones that need to change.

Two decisions were made in this planning round, refining the scope doc:

- **Waveform visualizer** (web Play tab uses Web Audio's `AnalyserNode` +
  Canvas, no direct RN equivalent): build a **simplified level meter** using
  the audio module's playback-status metering, not a full frequency
  waveform and not a total drop.
- **CI**: wire `mobile/` into a lightweight CI job **at scaffold time**
  (Phase 1), not deferred to the end — a minimal typecheck/build job so
  regressions are caught from day one, kept separate from
  `release:check`/`pr-check.yml` (which stays backend-only).

## Decisions to pin at Phase 1 kickoff (not resolved here — implementation-time calls)

These block later phases if left ambiguous, so whoever starts Phase 1 should
settle them explicitly before writing screens:

- **Expo SDK version** — determines available audio module (`expo-av` is in
  maintenance mode in recent SDKs; `expo-audio`/`expo-video` are the
  successors), camera/barcode API shape, and background-audio config shape.
- **Navigation library** — Expo Router (file-based, easier deep-linking for
  the QR-pairing flow) vs. React Navigation (`bottom-tabs`). Expo Router is
  the likely fit given the pairing deep-link surface, but pin it explicitly.
- **Bottom-sheet library** for the Play drawer (e.g. `@gorhom/bottom-sheet`).
- **EAS Build / code-signing strategy** — needed before any submittable
  build exists; don't leave to Phase 8.

## Phase 0 — Backend: bearer-token support for paired devices

**Goal:** A paired device can authenticate `requireDashboard`-gated routes
via `Authorization: Bearer <deviceToken>`, not just the
`pw_dashboard_session` cookie — zero behavior change for the existing web
`/pair` flow. This is the one hard backend dependency the whole Studio tab
rests on; everything else in the plan needs no backend changes.

**Files:**
- `src/api/auth.js`, `POST /api/auth/dashboard/device/redeem` (~lines
  189-203): add `token: deviceToken` to the JSON response body
  unconditionally, alongside the existing `Set-Cookie`. `deviceToken` is
  already the `createDeviceSession(label)` return value — just include it
  in the response. Harmless for the web `/pair` page, which ignores unknown
  JSON fields.
- `src/auth/middleware.js`, `hasDashboardSession(req)` (~lines 137-140): add
  the same cookie-then-`Authorization: Bearer`-fallback pattern already
  used for the listener side in `attachTier` (same file, ~lines 21-29):
  ```js
  let tokenStr = req.cookies?.pw_token;
  if (!tokenStr) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      tokenStr = authHeader.slice(7).trim();
    }
  }
  ```
  Resolve the token the same way, then feed it into the existing
  `validateDeviceSession` from `src/auth/devices.js` (already
  token-shape-agnostic — no change needed there). `requireDashboard` itself
  needs no direct edit; it already calls `hasDashboardSession`.
- `test/devices.test.js`: extend the existing pair→redeem→list→revoke test
  — capture `redeem.body.token`, add a follow-up `GET /api/dashboard/devices`
  call using `Authorization: Bearer <token>` instead of `Cookie`, assert 200
  + same device list, then after revoke assert the bearer call now 401s.
  Already in root `package.json`'s hardcoded `npm test` file list, so no
  script change needed.

**Gotchas:**
- Precedence must match `attachTier`: cookie checked first, header only as
  fallback — don't let a stray `Authorization` header override an active
  cookie session.
- Native `fetch` on iOS/Android isn't subject to browser CORS, unlike the
  `/embed` iframe path — no CORS work needed here or later. Physical-device
  reachability against a real tunnel is still untested until Phase 2/5,
  though.

**Verification:** `node --test test/devices.test.js`. Manual: `npm run dev`,
pair a device from web Studio's `Security.tsx`, confirm the redeem response
now includes `token`, confirm `Authorization: Bearer <token>` succeeds
against `GET /api/dashboard/devices`, confirm it 401s after revoking from
web.

## Phase 1 — `mobile/` workspace scaffold + tab shell + CI

**Goal:** An installable Expo app with 4-tab navigation and an empty
persistent sticky-transport shell, wired into the root the same way
`studio/`/`electron/` are, plus a lightweight CI job.

**Files:**
- `mobile/package.json` (own lockfile/dep tree — this repo is not an npm
  workspaces monorepo; `studio/` and `electron/` are separate npm projects
  wired in only via `npm --prefix <dir> ...` root scripts, and `mobile/`
  follows the identical pattern).
- `mobile/app.json`/`app.config.ts`, `mobile/tsconfig.json`.
- Navigation entry with 4 placeholder tabs (Discover, Play, Stack, Studio),
  using whichever nav library was pinned above.
- `mobile/src/state/stationStore.ts` — stub shape only, filled in Phase 2.
- `mobile/src/components/StickyTransportBar.tsx` — empty/collapsed shell,
  mounted outside the tab navigator now so Phase 3 doesn't need a layout
  retrofit.
- Root `package.json`: add `"dev:mobile": "npm --prefix mobile run start"`
  and `"build:mobile": "npm --prefix mobile install && npm --prefix mobile
  run build"`, mirroring `build:studio`'s two-step shape.
- New `.github/workflows/mobile-check.yml`: a minimal job running `npm
  --prefix mobile install && npm --prefix mobile run typecheck`, kept
  separate from `pr-check.yml`'s backend-only `release:check` gate.
- `.gitignore`: add `mobile`-specific build output entries (Expo's `.expo/`,
  native `ios/`/`android/` build artifacts) — only `node_modules/` is
  generically covered today.

**Verification:** `npm --prefix mobile install && npm --prefix mobile run
start`, confirm 4 tabs render with the empty sticky bar shell in both an iOS
simulator and Android emulator. Confirm the new GitHub Actions job runs on a
PR touching `mobile/`.

## Phase 2 — Discover tab: System.Pape + current-station + listener login

**Goal:** Real cross-station search/listing via System.Pape, a persisted
"current station" concept every later phase keys off of, and a lightweight
listener login/redeem screen (needed here, not deferred — tier-gated
Play/Stack content and Phase 7's account settings both depend on it).

**Pre-phase spike (do first, may block the rest of this phase):** confirm
System.Pape's `/stations` and `/directory` are actually production-stable,
not just the "Proposed" parts of its contract
(`docs/system-pape-contract.md`, `docs/system-pape-directory.md`) — this is
the scope doc's #1 open risk and a hard blocker for Discover if unresolved.

**Files:**
- `mobile/src/api/systemPape.ts` — port of `landing/listen.html`'s calls:
  `getDirectory()` → `GET {API_BASE}/directory`, `searchStations(q, limit)`
  → `GET {API_BASE}/stations?q=&limit=`, where `API_BASE =
  'https://system.paperweighthq.com/api/modules/paperweight'`
  (`landing/listen.html:369,485-513`).
- `mobile/src/api/stationClient.ts` — fetch wrapper parameterized by a
  station's `publicUrl` (+ optional bearer token); the RN analog of
  `studio/src/lib/api.js`'s `_fetch`/`_json`/`_send`/`_del` helpers, but
  without that file's same-origin-cookie assumption (its header comment
  states all web auth is httpOnly cookies except the one-time
  `X-Dashboard-Token` login exchange — mobile needs explicit bearer
  attachment throughout instead).
- `mobile/src/state/stationStore.ts` — fill in: AsyncStorage-persisted
  `{publicUrl, slug, name}`, exposed via a hook analogous to
  `studio/src/lib/hooks/useStationIdentity.ts` (currently a hardcoded
  single-station `useQuery` around `GET /api/health`) but parameterized by
  whichever station is selected. Also build (don't need to surface in UI
  yet) the ability to set an arbitrary manually-entered base URL, not only
  a System.Pape-sourced one — this is the mechanism Phase 7's Network
  Settings manual-URL override needs, and building the capability now in
  `stationStore`'s core shape avoids reworking it later.
- `mobile/src/screens/DiscoverScreen.tsx` — listing/search UI, station
  selection.
- `mobile/src/screens/ListenerLoginScreen.tsx` (or a modal reachable from
  Discover) — email/token-based listener login against the selected
  station, using the listener `pw_token` bearer path CLAUDE.md already
  documents as supported server-side.

**Gotchas:**
- Selecting a station must fully swap `stationClient`'s base URL; every
  downstream screen must re-read from `stationStore` rather than capture a
  stale `baseUrl` closure.
- Verify reachability against a real tunnel-exposed station from a physical
  device, not just simulator-to-localhost.

**Verification:** Manual smoke test against the real
`system.paperweighthq.com` endpoints. Local: `npm run dev`, exercise the
manual-URL path pointed at a LAN IP, confirm health check succeeds and
selection survives an app relaunch. Confirm listener login persists and is
readable by `stationClient` on subsequent calls.

## Phase 3 — Play tab: playback engine + sticky transport + drawer

**Goal:** Real audio playback (live HLS + on-demand) driven by the selected
station, with the sticky transport bar and Play tab's slide-up drawer
sharing one player engine, plus the simplified level meter.

**Files:**
- `mobile/src/player/PlayerEngine.ts` — RN analog of
  `studio/src/lib/hooks/usePlayerEngine.ts`'s state (`track`,
  `nowPlaying`/`stationQueue`/`recentlyPlayed` polled every 10s from `GET
  /api/stream/status` via `stationClient`, `playing`, on-demand progress,
  live/video flags), built on whichever audio module was pinned in Phase 1
  (`expo-av` or `expo-audio` — both give native HLS support via
  AVPlayer/ExoPlayer, so no `hls.js` equivalent is needed).
- `mobile/src/components/StickyTransportBar.tsx` — fill in real UI against
  `PlayerEngine`, mirroring `studio/src/components/StickyTransport.tsx`'s
  visibility rules (persistent across tabs; hidden when the drawer is fully
  open).
- `mobile/src/screens/PlayScreen.tsx` + `mobile/src/components/PlayerDrawer.tsx`
  — bottom-sheet ported from `studio/src/views/PlayerView.tsx`'s content
  (up-next/recently-played come straight off `PlayerEngine`, no separate
  query).
- `mobile/src/components/LevelMeter.tsx` — simplified bars/level indicator
  driven by the audio module's playback-status metering, replacing the web
  engine's `AnalyserNode` + Canvas waveform (`studio/src/components/primitives.tsx`'s
  `Waveform`) with something RN can actually render.

**Gotchas:**
- Background audio requires explicit `app.json` config
  (`ios.infoPlist.UIBackgroundModes: ["audio"]`, Android foreground-service
  permission) — configure here, not deferred; also a store-review concern
  (Phase 8).
- The 10s status-poll must pause/resume correctly across background/
  foreground transitions — no equivalent concern exists in the
  browser-tab-based web engine.
- Decide whether the drawer lives as a global overlay outside the tab
  navigator (recommended, survives tab switches) vs. per-screen state.

**Verification:** `npm run dev`, confirm live HLS and on-demand playback,
confirm the sticky bar appears on Stack/Studio while playing, confirm
background/lock-screen playback continues — **on real iOS and Android
hardware**, not simulators/emulators (background audio is unreliable there).

## Phase 4 — Stack tab: catalog + cross-station Stash

**Goal:** Browse the selected station's catalog and manage an on-device
Stash of saved/offline tracks aggregated across every station visited on
the phone. No backend changes needed.

**Files:**
- `mobile/src/screens/StackScreen.tsx` — Stack section (`GET
  /api/library/structure` via `stationClient`) + Stash section, mirroring
  `studio/src/views/StackView.tsx`'s split.
- `mobile/src/stash/stashStore.ts` — RN analog of
  `studio/src/lib/hooks/useOfflineSaves.ts` (currently raw `indexedDB`,
  storing full `Blob`s keyed by track id alone). RN equivalent:
  `expo-file-system` downloads (via a signed URL from the equivalent of
  `library.downloadUrl(id)`) to `documentDirectory` (not `cacheDirectory` —
  iOS can evict cache files under storage pressure) using
  `createDownloadResumable`, metadata in AsyncStorage/`expo-sqlite` keyed by
  a **composite `(canonicalStationBaseUrl, trackId)`** so Stash naturally
  aggregates across stations.
- `mobile/src/screens/StashList.tsx` (or a StackScreen section) — the
  aggregated cross-station view, with a storage-used indicator and
  clear-Stash action.

**Gotchas:**
- Pick and document a canonicalization rule for `stationBaseUrl`
  (scheme/trailing-slash/port normalization) before writing the store — it
  is load-bearing for correct de-dup/aggregation.
- Must respect the existing `media.offline_allowed` flag (migration 025)
  exactly like the web hook — verify the field is actually present in
  `/api/library/structure`'s response shape rather than assuming it.

**Verification:** `npm run dev`, save a mix of offline-allowed and
disallowed tracks (confirm disallowed ones are blocked), enable airplane
mode, confirm saved tracks still play. Run a second local instance on
another port, switch stations via Discover, save there too, confirm Stash
aggregates both without collision.

## Phase 5 — Studio pairing (QR scan) + curated essentials

**Goal:** QR-scan pairing using Phase 0's bearer flow, plus the v1
read/control essentials screens (live/now-playing control, quick stats,
release scheduling, notifications — confirm "notifications" means viewing
existing Discord-webhook-style notify events, not native push, before
building this screen).

**Files:**
- `mobile/src/screens/StudioGate.tsx` — unpaired state: camera-permission
  request + QR scan (`expo-camera`'s barcode API). Read
  `src/api/dashboard.js`'s `POST /api/dashboard/devices/pair` response
  shape (`{pairToken, pairUrl, expiresAt}`) at implementation time to
  confirm exactly what the scanner needs to parse out of the QR, then POST
  to `/api/auth/dashboard/device/redeem` via `stationClient`, and store the
  returned `token` in `expo-secure-store` (Keychain/Keystore-backed — this
  is a long-lived credential per `src/api/auth.js`'s cookie `maxAge`, not
  something for plain AsyncStorage).
- `mobile/src/api/dashboardClient.ts` — bearer-attaching client for
  `requireDashboard` routes, sending `Authorization: Bearer <deviceToken>`.
- `mobile/src/screens/studio/{NowPlaying,QuickStats,ReleaseScheduling,Notifications}Screen.tsx`
  — native ports of the corresponding desktop Studio views (confirm exact
  source files under `studio/src/views/` at implementation time).
- `mobile/src/screens/studio/DeviceSettings.tsx` — "sign out this device"
  (clears the local secure token only; actual revocation stays in web
  `Security.tsx`'s Authorized Devices panel per the scope doc — no separate
  mobile revocation UI needed for v1).

**Gotchas:**
- Camera permission needs `NSCameraUsageDescription` in `app.json` and a
  graceful denied-permission fallback with a Settings deep link — store
  reviewers check this specifically.
- The "no desktop nearby" bootstrap gap (scope doc's open risk) isn't
  solved here — `StudioGate`'s copy should clearly explain the
  desktop-first requirement rather than reading as a dead end.
- A core-seeming tab that's unusable without an external pairing step a
  reviewer can't perform is a plausible App/Play Store rejection reason —
  frame the unpaired state clearly as optional/creator-only, and prepare
  reviewer notes.

**Verification:** End-to-end on **real hardware** (emulator cameras can't
reliably read a physically displayed QR — use a second screen): pair via
web Studio's QR, confirm the device shows in "Authorized Devices," confirm
each essentials screen matches web dashboard data. Revoke from web, confirm
the mobile app's next dashboard call 401s and falls back cleanly to
`StudioGate`. `node --test test/devices.test.js` still green (Phase 0
regression check).

## Phase 6 — Studio media upload

**Goal:** Upload a media file from the phone into the paired station's
vault, reusing the existing upload endpoint — no new backend endpoint
expected.

**Files:**
- `mobile/src/screens/studio/UploadScreen.tsx` — file/media picker
  (`expo-document-picker`/`expo-image-picker`) + upload progress UI.
- `mobile/src/api/dashboardClient.ts` — add an `upload(fileUri, ...)`
  method built on `expo-file-system`'s `uploadAsync` (multipart + progress
  callbacks), targeting the same endpoint `studio/src/lib/api.js`'s upload
  method already calls.

**Gotchas:**
- The existing endpoint's multer size limit (~2GB) is almost certainly not
  the binding constraint — the scope doc's unvalidated risk is
  timeout/retry behavior over cellular. Test a large real-cellular upload
  before calling this phase done.
- If that test surfaces resumable/chunked-upload needs, that's backend
  work outside current scope — flag it back rather than absorbing it
  silently into the mobile client.
- Decide explicit v1 behavior for app-backgrounded-mid-upload (Expo's
  background-upload story is limited) — e.g., warn the user to keep the
  app foregrounded, rather than silently dropping failed uploads.

**Verification:** `npm run dev`, paired device: upload a small file,
confirm it lands in the vault scanner/web media list; upload 500MB+ over
WiFi and verify progress + resulting file integrity; one real-cellular
upload test.

## Phase 7 — Settings modals (App settings + Account settings)

**Goal:** Discover tab's two settings modals: app-level prefs/network
override, and the selected station's listener account management.

**Files:**
- `mobile/src/screens/modals/AppSettingsModal.tsx` — theme toggle, OS
  WiFi-settings deep link, manual station URL/LAN-IP override UI (wired to
  the capability already built into `stationStore` in Phase 2).
- `mobile/src/screens/modals/AccountSettingsModal.tsx` — listener account
  view (email verification status, supporter tier, tipping identity) via
  `stationClient`, using the listener login from Phase 2.

**Gotchas:**
- iOS cannot deep-link directly into the WiFi pane — only the Settings app
  root (the private `App-Prefs:root=WIFI` scheme gets apps rejected).
  Android does support a direct `ACTION_WIFI_SETTINGS` intent. Reflect this
  platform asymmetry explicitly in the UI copy.

**Verification:** From a physical device on the same WiFi as a running
`npm run dev` instance, use the manual-URL override to point at its LAN IP
and confirm station switch works without Discover/System.Pape. Log in as a
listener against the local station and confirm email verification/tier/
tipping identity match the DB.

## Phase 8 — Polish, store-readiness

**Goal:** Cross-cutting hardening before store submission.

**Files:**
- `mobile/app.json` — finalize permission-usage descriptions, icons/splash,
  bundle IDs, versioning.
- Error/empty/offline states across all screens (station unreachable,
  System.Pape unreachable, expired pairing, failed upload).
- Store-review pass: background-audio justification copy, camera-permission
  justification copy, "Studio behind pairing" framing, and an accurate
  privacy disclosure — the app talks to arbitrary third-party self-hosted
  servers plus System.Pape, and both stores' privacy labels need this
  disclosed accurately.

**Verification:** Full device walk-through on real iOS and Android: fresh
install, deny→grant camera, deny→grant background audio, airplane-mode
resilience, and a complete Discover → select station → pair Studio → play →
save Stash → upload flow with no debugger attached.

## Cross-phase risks carried through (from the scope statement + this round)

- System.Pape production-readiness (Phase 2 blocker).
- QR-pairing's desktop-first bootstrap requirement (Phase 5, not solved,
  just documented for users/reviewers).
- Upload behavior over real cellular (Phase 6, may bounce back to backend
  scope if it fails).
- Background audio correctness and store-review framing for the QR-gated
  Studio tab (Phases 3, 5, 8).
