# Paperweight Mobile — Handoff

**Read this before starting a phase. Update it immediately after finishing
one — status + a dated entry — before moving on to the next.**

This file tracks *status only*. For *what* and *why*, see:
- `docs/plans/2026-08-17-mobile-app-scope.md` — product/tech scope, decisions made
- `docs/plans/2026-08-17-mobile-app-implementation-plan.md` — the 9-phase build order this checklist follows

## Phase checklist

| Phase | Description | Status |
|---|---|---|
| 0 | Backend: bearer-token support for paired devices | ✅ Done |
| 1 | `mobile/` workspace scaffold + tab shell + CI | ✅ Done |
| 2 | Discover tab: System.Pape + current-station + listener login | ✅ Done |
| 3 | Play tab: playback engine + sticky transport + drawer | ✅ Done (unverified on hardware — see log) |
| 4 | Stack tab: catalog + cross-station Stash | ✅ Done (unverified on hardware — see log) |
| 5 | Studio pairing (QR scan) + curated essentials | ⬜ Not started |
| 6 | Studio media upload | ⬜ Not started |
| 7 | Settings modals (App settings + Account settings) | ⬜ Not started |
| 8 | Polish, store-readiness | ⬜ Not started |

## Phase log

### Phase 0 — Backend: bearer-token support for paired devices
**Status: Done** (2026-08-17)

What was built:
- `POST /api/auth/dashboard/device/redeem` (`src/api/auth.js`) now also
  returns the raw device token in its JSON body (`{ ok: true, token }`),
  alongside the existing `Set-Cookie`. Web `/pair` is unaffected — it
  ignores the extra field and keeps using the cookie.
- `hasDashboardSession` (`src/auth/middleware.js`) now accepts
  `Authorization: Bearer <deviceToken>` as a fallback when no
  `pw_dashboard_session` cookie is present, mirroring the listener-side
  `attachTier` cookie-then-bearer pattern. Cookie is still checked first.
- Test coverage extended in `test/devices.test.js`: redeem response
  includes the token, a bearer-authenticated request succeeds against
  `GET /api/dashboard/devices`, and 401s the same as the cookie path once
  the device is revoked.
- Full suite: 210/211 passing (the one failure, a landing-page CSP/fonts
  test, is pre-existing and unrelated — verified it fails identically on
  the base branch).

Commit: `38451e8` — "Add bearer-token support for paired dashboard devices"

Nothing left open in this phase.

### Phase 1 — `mobile/` workspace scaffold + tab shell + CI
**Status: Done** (2026-08-17)

Decisions pinned:
- **Expo SDK 57** (latest stable on npm at kickoff) — gives `expo-audio`/
  `expo-video` instead of maintenance-mode `expo-av` when Phase 3 needs them.
- **Expo Router** for navigation — file-based, better fit for the QR-pairing
  deep-link surface than React Navigation's `bottom-tabs`.
- **`@gorhom/bottom-sheet`** for the Play drawer — not installed yet (no
  drawer to build until Phase 3), decision recorded here so Phase 3 doesn't
  re-litigate it.
- **EAS Build with EAS-managed credentials** for code-signing — not
  initialized yet (`eas init` needs an authenticated Expo account, out of
  scope for a scaffold-only phase); pinned so Phase 8 doesn't have to choose.

What was built:
- `mobile/` scaffolded via `npx create-expo-app@latest` (SDK 57, TypeScript +
  Expo Router template), built in a scratch dir and merged in rather than
  run directly against the existing `mobile/` directory (auto-mode's
  destructive-action classifier flagged running a project generator inside
  an already-populated directory; verified first that the only existing file
  was this handoff doc, so nothing was at risk).
- Swapped the template's default `NativeTabs` (an *unstable* API, path
  literally `expo-router/unstable-native-tabs`) for standard `expo-router`
  `Tabs` — needed stable control over layout to mount a persistent bar
  outside the tab navigator.
- Route structure: `src/app/_layout.tsx` (root `Stack`, for future modal
  screens like pairing/settings) → `src/app/(tabs)/_layout.tsx` (`Tabs` with
  4 screens: `index` labeled "Discover", `play`, `stack`, `studio` — Discover
  is `index.tsx` so it's the app's default `/` route).
- `src/components/StickyTransportBar.tsx` — empty shell (renders nothing,
  `pointerEvents="none"`), mounted as a sibling of `<Tabs>` in the tabs
  layout so switching tabs doesn't remount it. Phase 3 fills in real content
  and positions it above the tab bar.
- `src/state/stationStore.ts` — stub types only (`StationIdentity`,
  `StationStoreState`, with a `manualBaseUrl` field already in the shape for
  Phase 7's network override), no persistence/hook yet.
- `src/components/PlaceholderScreen.tsx` + 4 placeholder screens, each
  naming which phase fills them in.
- Removed template-only cruft not needed here: `.claude/`, `CLAUDE.md`,
  `AGENTS.md`, `LICENSE`, `README.md` (repo convention — neither `studio/`
  nor `electron/` carry their own), the demo hero/icon/badge components and
  their images, and `scripts/reset-project.js` (a destructive
  "wipe-and-reset" convenience script that would delete this app's real
  `src/` if ever run by accident).
- Also dropped now-unused demo-only deps from `package.json`: `@expo/ui`,
  `expo-device`, `expo-glass-effect`, `expo-symbols`, `expo-web-browser`.
  Kept `expo-font`/`expo-image`/`expo-linking` even though unused yet —
  standard infra, `expo-linking` specifically needed for the QR-pairing deep
  link in Phase 5.
- `mobile/package.json`: renamed to `@paperweight/mobile`, added
  `typecheck` (`tsc --noEmit`) and `build` (`expo export --platform web` —
  a stand-in that validates the whole route tree compiles; Phase 8 replaces
  it with a real EAS Build invocation once credentials exist) scripts.
- Root `package.json`: added `dev:mobile` / `build:mobile`, mirroring
  `build:studio`'s two-step (`install` then `run build`) shape.
- Root `.gitignore`: added `mobile/.expo/`, `mobile/dist/`,
  `mobile/web-build/`, `mobile/expo-env.d.ts`, `mobile/ios/`,
  `mobile/android/` (mobile/ ships its own `.gitignore` too, covering the
  same paths for anyone working inside that directory directly).
- `.github/workflows/mobile-check.yml` — new, path-filtered to `mobile/**`,
  runs `npm --prefix mobile install && npm --prefix mobile run typecheck`.
  Kept separate from `pr-check.yml`'s backend-only `release:check` gate, per
  plan.

Verification done:
- `npx tsc --noEmit` — clean.
- `npx expo export --platform web` — all 4 routes (`/`, `/play`, `/stack`,
  `/studio`) bundle and export successfully. This caught a real bug: the
  first cut named the Discover screen `discover.tsx`, which left no route
  resolving `/` (only `+not-found`) — renamed to `(tabs)/index.tsx` to fix.
- Real-device verification (2026-08-17, alongside Phase 2 — see that
  section): confirmed on the physical Samsung SM-A125U (Android 11) via
  Expo Go. All 4 tabs render, switch correctly, and show their placeholder
  copy. **Found and fixed one real bug this way that the web export couldn't
  catch:** the bottom tab bar icons rendered as empty "tofu" (missing-glyph)
  boxes on Android. Root cause, found by reading
  `expo-router`'s bundled bottom-tabs fork
  (`node_modules/expo-router/build/react-navigation/bottom-tabs/views/BottomTabBar.js`):
  when a `Tabs.Screen` sets no `options.tabBarIcon`, it deliberately falls
  back to rendering `MissingIcon` — a debug placeholder, not a rendering
  bug — specifically to flag screens that forgot to set one. Fixed by adding
  `@expo/vector-icons` (`npx expo install`, standard Expo-bundled icon set)
  and a `tabBarIcon` (`Ionicons`, filled when focused / outline when not) to
  each of the 4 `Tabs.Screen` entries in `(tabs)/_layout.tsx`: `compass` for
  Discover, `play-circle` for Play, `layers` for Stack, `options` for
  Studio. Re-verified live on the same device after the fix — real icons
  render correctly in both active/inactive states.

Nothing else left open in this phase.

### Phase 2 — Discover tab
**Status: Done** (2026-08-17)

Pre-phase spike run: confirm System.Pape's `/stations` and `/directory` are
production-stable, not just the "Proposed" parts of
`docs/system-pape-contract.md` / `docs/system-pape-directory.md`.

- First check (2026-08-17, morning): both `/directory` and `/stations`
  returned `500 Internal Server Error` while `/api/health` on the same host
  returned `200` — isolated to those two module routes, not the host.
- Re-check (2026-08-17, ~1h20m later): all three now `200`. `/directory` →
  `[]`, `/stations?q=&limit=20` → `{"stations":[]}` — both match the
  documented response shapes exactly (empty is expected with no stations
  currently opted into search). **Confirmed transient — was not a lasting
  backend bug.** Spike now passes; no longer a blocker.
- Re-checked again at the start of Phase 2 work itself (2026-08-17,
  afternoon): both still `200` with the same empty shapes. Stable across
  three checks now — treating this as settled, not re-verifying again next
  phase.

What was built:
- `mobile/src/api/systemPape.ts` — `getDirectory()`/`searchStations(q,
  limit)`/`sortStations()`, ported field-for-field from `landing/listen.html`'s
  `normalizeDirectoryEntry`/`normalizeSearchEntry`/`sortStations` (live-first,
  then listener count).
- `mobile/src/api/stationClient.ts` — `StationClient` class parameterized by
  a station's base URL + optional bearer token; `get`/`post` primitives plus
  typed wrappers for `/api/health`, `/api/listener/login`,
  `/api/tokens/redeem`, `/api/listener/me`. No same-origin-cookie assumption
  anywhere — every call attaches `Authorization: Bearer` explicitly when a
  token is present, per the plan's departure from `studio/src/lib/api.js`.
- `mobile/src/state/stationStore.tsx` — filled in from the Phase 1 stub
  (renamed `.ts` → `.tsx`, it now hosts a `StationStoreProvider`). AsyncStorage-
  persisted `{ station, manualBaseUrl, authByStation }`; `authByStation` is
  keyed by *effective base URL* (`manualBaseUrl || station.publicUrl`) so a
  listener's login is correctly scoped per-station, not global. Exposes
  `useStationStore()` and `useStationClient()` — the latter memoizes a fresh
  `StationClient` off the current `baseUrl`/token so no screen can capture a
  stale closure (the Phase 2 plan's explicit gotcha). `manualBaseUrl`
  plumbing is in place (wins over `station.publicUrl` when set) but has no UI
  yet — Phase 7 builds that surface, per plan.
- `mobile/src/screens/DiscoverScreen.tsx` — directory listing by default,
  debounced (300ms) search-as-you-type against `/stations`, request-id
  guarding against out-of-order responses (same pattern as `listen.html`).
  Tapping a result calls `setStation(...)`; the selected station is
  highlighted in the list and shown in a header strip with a "Log in" entry
  point. Loading/empty/error states with retry.
- `mobile/src/screens/ListenerLoginScreen.tsx` + `mobile/src/app/listener-login.tsx`
  — modal route (`presentation: 'modal'`, registered in root `_layout.tsx`).
  Two tabs: email/password (`POST /api/listener/login`, which already
  returns `{ token, tier }` in its body — no backend change needed) and
  creator-issued token redeem (`POST /api/tokens/redeem`, which only returns
  `{ tier }` — the client persists the raw token string the user typed as
  the bearer credential, since that string *is* the credential). Blocks with
  an explanatory message if no station is selected yet.
- `mobile/src/constants/theme.ts` — added `accent`/`accentSoft`/`live`/`border`
  color tokens (pink/red accent, not the web Studio's lime/coral — the
  attached mobile mockups used a different accent direction for this app
  specifically, and matched the app's own Discover/Stack/Play/Studio tab
  names, so treated as an intentional mobile-specific brand call rather than
  a mismatch to reconcile against `studio/`).
- New dependency: `@react-native-async-storage/async-storage` (added via
  `npx expo install`, resolved to `2.2.0` for SDK 57). Did **not** add
  `expo-linear-gradient` — the mockups' gradient accents are approximated
  with solid `accent`/`accentSoft` tokens instead, to avoid introducing an
  unverified native dependency (see verification note below).

Verification done:
- `npx tsc --noEmit` — clean.
- `npx expo export --platform web` — all 11 routes bundle, including the new
  `/listener-login` modal route.
- Live backend smoke test: ran `npm run dev` against the real local station
  (Rolling Woods) and curl'd the exact endpoints `stationClient.ts` calls —
  `/api/health` → `{station:"Rolling Woods",...}`; `/api/tokens/redeem` with
  a garbage token → `401 {error}`; a freshly generated real token (via
  `node scripts/gen-token.js`) → `200 {tier:"subscriber"}`, and that same raw
  token as `Authorization: Bearer` against `/api/tokens/me` → `200
  {authenticated:true,tier:"subscriber"}`. Confirms the redeem-then-bearer
  flow `ListenerLoginScreen` implements actually works end-to-end against a
  real server, not just against the read source. (Leaves one harmless test
  subscriber token in the local dev DB — not tied to any real subscriber.)
- **Real-device pass, done later the same day (2026-08-17 evening)**, once a
  physical Android device became available (the `~/a12` Galaxy A12 — see
  `[[a12-project-paused]]` memory / that repo's `HANDOFF.md`): connected via
  `adb` over USB, ran `npx expo start --android`, which auto-installed the
  matching SDK-57 Expo Go build and loaded the app. Confirmed on real
  hardware: the Discover screen renders and makes a real call to
  System.Pape's `/directory` (correctly empty, matching the live backend —
  same result as the earlier curl checks); typing a query correctly switches
  to debounced `/stations?q=` search and shows the search-specific "No
  stations match that search" copy (distinct from the directory's empty-state
  copy — both code paths confirmed live, not just by reading the source);
  the listener-login modal opens correctly via deep link
  (`exp://<host>/--/listener-login`) and correctly shows its
  no-station-selected guard message, since the live directory has no
  stations to select yet. Did not get to exercise the actual login/redeem
  submit path or a selected-station state, since System.Pape's directory is
  genuinely empty right now (nothing to select) — that part is still only
  verified by the earlier backend curl test + code review, not on-device.
  SDK version banner on-device confirmed `57.0.0`, matching `package.json`.
  Also used this session to verify Phase 1's tab shell on real hardware (see
  that phase's log entry, including a bug found: tab bar icon tofu boxes).
- **Device-driving notes for next time:** this device is (was) a Device
  Owner–managed kiosk device for the unrelated `~/a12` project — kiosk
  enforcement is soft-disabled but `adb shell input keyevent KEYCODE_HOME`
  and `adb shell am start ...` both report a cosmetic `Error: Activity not
  started, unknown error code 101` on this device/OS combo even when the
  launch actually succeeds underneath (confirmed via `adb logcat`, not just
  the `am start` exit text) — don't trust that error text alone as a
  failure signal here. Plain `adb shell input tap`/`text`/`swipe` all work
  reliably throughout. The screen sleeps on its own idle timeout during
  longer waits; `adb shell input keyevent KEYCODE_WAKEUP` before each
  screenshot avoids capturing a blank black frame.
- Still not done: the plan's "manual-URL path pointed at a LAN IP from a
  *second, separate* physical device" check (this pass used one device
  against the same-machine dev server via `adb`-forwarded/LAN Metro, not a
  true second-device-on-LAN scenario) — low priority, the underlying
  mechanism is already verified by code review + the backend curl test.

Nothing else left open in this phase.

### Phase 3 — Play tab
**Status: Done** (2026-08-30)

Source: `mobile/new_play/play.tsx`, a designer-supplied visual mockup (plain
web JSX/Tailwind/`@iconify/react` — not working RN code, see
`mobile/DESIGN-SPEC.md`) — ported into real RN screens/components below,
then retired (see "Retiring `mobile/new_play/`" at the end of this entry).

Decisions pinned:
- **`expo-audio` + `expo-video`** (SDK 57), not `expo-av`, matching the Phase
  1 decision log. Verified directly against the installed packages' type
  declarations rather than assumed:
  - `expo-audio`'s config plugin defaults `enableBackgroundPlayback: true`,
    which auto-injects iOS `UIBackgroundModes: ["audio"]` and Android's
    `FOREGROUND_SERVICE`/`FOREGROUND_SERVICE_MEDIA_PLAYBACK` permissions at
    prebuild time — just adding the plugin to `app.json` was enough, no
    hand-written platform config needed (resolves the Phase 3 plan's "not
    deferred" gotcha directly). Passed `recordAudioAndroid: false` explicitly
    since this app never records — the plugin's default is `true` and would
    otherwise request `RECORD_AUDIO` unnecessarily. **Caveat found**: the
    plugin unconditionally adds `NSMicrophoneUsageDescription` to iOS
    Info.plist regardless of any option (its `createPermissionsPlugin` call
    isn't gated) — flagging for Phase 8's store-review pass since we never
    actually request microphone access.
  - `expo-video`'s config plugin is a no-op unless `supportsBackgroundPlayback`/
    `supportsPictureInPicture` are explicitly passed (unlike `expo-audio`'s
    default-on behavior) — passed `{ supportsBackgroundPlayback: true }`
    explicitly in `app.json`.
  - Real-time level metering is genuinely possible: `expo-audio`'s
    `useAudioSampleListener` delivers normalized PCM frames per channel
    while `player.isAudioSamplingSupported` is true — `LevelMeter` uses this
    for real RMS-per-bucket bars, falling back to a looping idle animation
    on devices/builds where sampling isn't supported, rather than being a
    permanently-fake bar chart.
- **PlayerDrawer as a global overlay** (`@gorhom/bottom-sheet`, plain
  `BottomSheet` not `BottomSheetModal` — no portal needed since it's mounted
  once at the tabs-layout level, already inside `GestureHandlerRootView`
  added to root `_layout.tsx`), single snap point (`92%`), closed by
  default. The Play *tab* route (`(tabs)/play.tsx`) has no screen content of
  its own — visiting it just calls `playerDrawerRef.current?.expand()`
  (a module-scoped ref, since only one drawer instance is ever mounted) via
  `useFocusEffect`; `StickyTransportBar` opens it the same way when tapped.
- **One shared `PlayerEngine` instance app-wide**, not per-screen — added
  `mobile/src/player/PlayerEngineContext.tsx` (not in the phase doc's literal
  file list, but required: `StickyTransportBar`, `PlayScreen`/`PlayerDrawer`,
  and `StackScreen` all need to observe/control the *same* playback session,
  or each would spin up its own `AudioPlayer`/`VideoPlayer` + 10s poll loop).
  Mounted in root `_layout.tsx`, inside `StationStoreProvider`.
- One persistent `AudioPlayer` and one persistent `VideoPlayer` (not a fresh
  element per track like the web engine's `new Audio()` trick) — `.replace()`
  swaps sources. This meant on-demand playback listeners had to be tracked
  in a ref (`odSubsRef`) and explicitly torn down before attaching a new set,
  or stale listeners from a previous track would keep firing against the new
  source — a real correctness difference from the web engine's per-track
  element isolation, not just a naming difference.

What was built:
- `mobile/src/api/stationClient.ts` — added `streamStatus()`, `ping()`,
  `libraryStructure()`, `streamQuota()`, `downloadUrl()`, `streamUrl()`,
  `previewUrl()`, `artworkUrl()`, `hlsUrl()`, `authHeader()`, `resolveUrl()`.
- `mobile/src/player/types.ts` — `StreamStatus`/`LibraryItem`/`LibraryStructure`/
  `OnDemandTrack`/etc. types (field names confirmed against `src/api/library.js`'s
  `formatItem()`, including `offlineAllowed` camelCase), plus
  `isPlayableTrack`/`canStash`/`swatchFor`/`formatDuration` ported verbatim
  from `studio/src/lib/hooks/usePlayerEngine.ts` and `studio/src/lib/library.ts`.
- `mobile/src/player/PlayerEngine.ts` + `PlayerEngineContext.tsx` — the
  engine itself: 10s status polling (paused in background unless something's
  playing, resumed immediately on foreground via `AppState`), live HLS
  attach with the same `[3000, 6000, 12000, 30000]` exponential-backoff
  reconnect as web (audio via `AudioStatus.error`, video via `expo-video`'s
  different `statusChange` event — the two packages have unrelated event
  surfaces, handled with separate listeners), on-demand/preview playback
  with 30s preview timer and 30s revert-to-live, quota/next-up-arming logic
  ported from the web engine.
- `mobile/src/components/LevelMeter.tsx`, `PlayerDrawer.tsx`,
  `StickyTransportBar.tsx` (filled in from its Phase 1 empty shell),
  `mobile/src/screens/PlayScreen.tsx` — UI layer, shaped like
  `new_play/play.tsx`'s mockup (phone-width layout, not `PlayerView.tsx`'s
  desktop grid): live/on-demand status header, artwork placeholder (no
  press-photo API on mobile yet — Studio-only content), level meter or
  progress bar, transport controls, up-next/recently-played lists sourced
  directly off `PlayerEngine` (no separate query, per plan). Share/tip
  buttons from the mockup were **not** wired — no mobile modal exists for
  either yet, out of this phase's file list.
- `app.json` — `expo-audio`/`expo-video` plugin entries (see decisions
  above).

Verification done:
- `npx tsc --noEmit` — clean for every new/changed file (four pre-existing
  errors remain, all in `mobile/new_play/*.tsx` — deleted at the end of this
  entry — and one unrelated pre-existing `@/global.css` resolution error in
  `constants/theme.ts` predating this phase, confirmed via `git diff`/`git log`
  on that file).
- Manual line-by-line review against `usePlayerEngine.ts`,
  `StickyTransport.tsx`, `PlayerView.tsx` for logic parity.
- **Not verified — needs a real-device pass before shipping**: this is a
  non-interactive cloud session with no physical iOS/Android hardware, and
  the phase plan's own verification section requires real devices for
  exactly this reason (background audio is unreliable in
  simulators/emulators). Specifically unverified:
  - Live HLS audio/video playback and the reconnect/backoff loop against a
    real network.
  - Background/lock-screen audio surviving app suspend — the single biggest
    risk item in this phase.
  - Whether an `expo-video` `VideoPlayer` truly keeps emitting audio with no
    `VideoView` currently mounted (assumed yes, based on `staysActiveInBackground`/
    `showNowPlayingNotification` being player-level properties independent of
    any view in the type declarations — not confirmed by an actual on-device
    test).
  - `useAudioSampleListener`/`isAudioSamplingSupported`'s real behavior on
    iOS vs. Android.

### Phase 4 — Stack tab
**Status: Done** (2026-08-30)

Source: `mobile/new_play/stack.tsx` (same mockup-not-code caveat as Phase 3).

Decisions pinned:
- **Canonicalization rule** for the cross-station Stash key (lowercase
  scheme+host, strip default port 443/80 and trailing slash(es), drop
  query/hash) — implemented in `canonicalizeBaseUrl()`,
  `mobile/src/stash/stashStore.ts`. Known limitation, documented in code: two
  differently-formed URLs for the same physical station (e.g. a manual LAN
  IP vs. System.Pape's `publicUrl`) will not collide unless they canonicalize
  identically — true station-identity resolution is out of scope.
- **`expo-file-system`'s new `File`/`Directory`/`Paths` API**, not the legacy
  `createDownloadResumable` the phase doc's prose assumed — confirmed by
  reading the installed package's types: SDK 57's default export is the new
  API (`expo-file-system/legacy` carries the old one).
  `File.createDownloadTask(url, destination).downloadAsync()` downloads to
  `Paths.document/stash/` (not cache — iOS can evict cache files under
  storage pressure, per the plan).
- **AsyncStorage-only metadata** (a single JSON array under one key,
  consistent with `stationStore.tsx`'s existing pattern) — not
  `expo-sqlite`, which the phase doc offered as an either/or. A simple list
  didn't need a second persistence mechanism.
- **No separate `StashList.tsx` screen** — folded into `StackScreen.tsx`'s
  "My Stash" segment behind a segmented control ("Station Stack" / "My Stash
  (N)"), matching `new_play/stack.tsx`'s actual layout rather than web
  `StackView.tsx`'s two-accordion-card split. The phase doc offered this as
  an either/or; the approved mockup picks the in-screen-section option.
- **`offlineAllowed` field confirmed present** on every catalog item
  (`src/api/library.js:266`, `offlineAllowed: row.offline_allowed === 1`) —
  resolving that Phase 4 gotcha by direct code read, not by assumption.
- Project/collection detail is a **separate pushed screen**
  (`mobile/src/app/project/[id].tsx` → `ProjectDetailScreen.tsx`), not an
  in-place expanding drawer like web's `StackView.tsx` — matches the
  mockup's flatter top-level layout (grid, then a flat on-demand list).

What was built:
- `mobile/src/stash/types.ts`, `stashStore.ts` (`useStashStoreState` hook:
  `save`/`remove`/`play`/`stop`, `records`/`savedKeys`/`playingKey`/
  `totalSizeBytes`), `StashContext.tsx` (`StashProvider`/`useStash()`,
  mounted in root `_layout.tsx` nested inside `PlayerEngineProvider` — Stash
  playback calls `engine.pause()` first, since it's intentionally a separate
  player from the main `PlayerEngine`, matching web's same separation
  between the live element and offline `Blob` playback).
- `mobile/src/screens/StackScreen.tsx` — catalog segment (debounced search,
  same 300ms pattern as `DiscoverScreen`; 2-column project grid; flat
  on-demand tracks list with lock/stash icons) and Stash segment (saved
  tracks, storage-used indicator, Clear action). No second footer/status
  strip — relies on the already-global `StickyTransportBar` for that role
  (an intentional simplification versus web's separate `stack-footer-glass`
  strip).
- `mobile/src/screens/ProjectDetailScreen.tsx` + `mobile/src/app/project/[id].tsx`
  — full collection tracklist, credits/genre chips, runtime.
- `mobile/src/app/(tabs)/stack.tsx` — swapped off `PlaceholderScreen` onto
  `StackScreen`, same pattern as `index.tsx` → `DiscoverScreen`.

Verification done:
- `npx tsc --noEmit` — clean (same four pre-existing/unrelated errors as
  Phase 3's entry, nothing new from this phase's files).
- Manual review against `StackView.tsx`/`useOfflineSaves.ts` for stash
  eligibility (`canStash`) and catalog-shape parity.
- **Not verified — needs a real-device pass before shipping**: actual file
  downloads via `File.createDownloadTask` to real device storage, airplane-
  mode offline playback, storage-used accounting against real file sizes,
  and Stash aggregation across two real station instances on one phone (the
  phase doc's "run a second local instance on another port" test) — none of
  this touches real device storage/network in this sandboxed session.

### Retiring `mobile/new_play/`
Once both phases above were wired and visually reconciled against the
mockups, `mobile/new_play/discover.tsx` (already superseded by the real
`DiscoverScreen.tsx` since Phase 2), `play.tsx`, and `stack.tsx` — along with
the now-empty `mobile/new_play/` directory — were deleted. This *is* the
"remove the seeded mock data" step: all of the mock content (station names,
track lists, listener counts, the hardcoded level-meter bars) was inline
JSX literal in these three files, with no separate mock-data file to clean
up separately.

### Phase 5 — Studio pairing + curated essentials
**Status: Not started**

Confirm "notifications" in scope means viewing existing Discord-webhook
notify events, not native push, before building that screen.

### Phase 6 — Studio media upload
**Status: Not started**

### Phase 7 — Settings modals
**Status: Not started**

### Phase 8 — Polish, store-readiness
**Status: Not started**

## Open decisions carried forward

- System.Pape `/stations` / `/directory` flapped once early on 2026-08-17
  but has now checked out `200` three times since (see Phase 2 log) —
  considering this settled, not a live risk anymore.
- Real-device verification for Phases 1-2 is now done (2026-08-17 evening,
  see Phase 2 log) via the `~/a12` project's physical Galaxy A12 over `adb`
  + Expo Go. One real bug found *and fixed* this way (tab bar icon tofu
  boxes → real `Ionicons`, Phase 1 section). Login/redeem submit and a
  selected-station state are still unverified on-device (System.Pape's live
  directory is empty, nothing to select) — pick that up once either a
  station opts in or alongside Phase 3 when there's more reason to be
  on-device anyway.
- `mobile/` still carries a leftover nested `.git/` from `create-expo-app`'s
  default init (Phase 1) — never committed to, dead weight, blocked from
  auto-cleanup by the destructive-action classifier since it wasn't
  explicitly requested. Fine to leave; flag if it ever causes confusion
  (e.g. someone assumes `git log` inside `mobile/` reflects real history).
- Phases 3-4 (2026-08-30) were built and typechecked in a non-interactive
  cloud session with no physical iOS/Android hardware available — real-device
  verification (background/lock-screen audio, actual HLS reconnect behavior,
  on-device Stash downloads + airplane-mode playback, cross-station Stash
  aggregation with two real running stations) is still outstanding. Pick
  this up on real hardware before shipping either tab; see each phase's log
  entry above for the exact unverified list. Also carry forward from Phase
  3: confirm whether an `expo-video` player really keeps emitting audio with
  no `VideoView` mounted (assumed yes from its type declarations, not
  device-tested) — if it turns out not to, live-video needs to fall back to
  the live-audio HLS URL whenever no `VideoView` is visible.
