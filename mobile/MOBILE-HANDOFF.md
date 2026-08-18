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
| 3 | Play tab: playback engine + sticky transport + drawer | ✅ Done |
| 4 | Stack tab: catalog + cross-station Stash | ✅ Done |
| 5 | Studio pairing (QR scan) + curated essentials | ✅ Done |
| 6 | Studio media upload | ✅ Done |
| 7 | Settings modals (App settings + Account settings) | ✅ Done |
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
**Status: Done** (2026-08-17)

Pre-implementation research: spawned an Explore agent to read
`studio/src/lib/hooks/usePlayerEngine.ts`, `StickyTransport.tsx`,
`PlayerView.tsx`, `primitives.tsx`'s `Waveform`, and the `/api/stream/status`
backend route/response shape in full, plus how on-demand/preview/HLS URLs
are built and how vault/tier gating applies — needed exact shapes to port
faithfully rather than re-deriving from memory. Full findings absorbed into
the files below; not re-transcribed here.

**Scope decisions made, not re-litigate:**
- **Audio only, no video.** Live-video broadcasts, video station tracks, and
  on-demand video are out of scope for this phase — `expo-video` plus
  tier-gated live-video auth is real additional surface the Phase 3 file
  list never called for. `PlayerEngine` always ignores `liveVideoActive` and
  picks between live-audio/station-audio only.
- **No real audio-reactive level meter.** The web `Waveform` taps a genuine
  Web Audio `AnalyserNode` off the live `<audio>` element — there's no RN/Expo
  equivalent for *playback* (only `expo-audio`'s recorder exposes metering;
  real playback sampling via `useAudioSampleListener` forces an Android
  `RECORD_AUDIO` permission prompt for what would only ever be decorative).
  `LevelMeter.tsx` animates the web version's own idle/no-analyser fallback
  bar row instead of faking spectral data — same visual language, honestly
  not audio-reactive.
- **No scrub/seek UI** — the web player doesn't have one either (confirmed
  from source, not assumed); `odProgress`/`odElapsed` are display-only.
- **No skip/next/prev** — the web version's skip lives in `StickyTransport`
  and depends on the full library track list (`api.library.structure()`),
  which doesn't exist on mobile until Phase 4. `PlayerEngine.selectTrack`/
  `goLive` are implemented and ready for Phase 4 to call, but nothing in
  Phase 3's UI can reach them yet (no track-browsing surface exists) — quota
  display and next-up arming are deferred with that same reasoning.
- **The mobile-only "drawer" pattern**: `PlayerDrawer` (a
  `@gorhom/bottom-sheet` `BottomSheetModal`) holds all of `PlayerView`'s
  real content and is mounted globally (sibling of `<Tabs>`, survives tab
  switches, per the plan's own recommendation). It opens two ways: tapping
  `StickyTransportBar` from any tab, or automatically when the Play tab
  itself gains focus. `PlayScreen.tsx` stays deliberately thin — a
  station-name/"tap to reopen" prompt for whatever's visible once the
  drawer is dismissed, not a duplicate of the drawer's content.

What was built:
- `mobile/src/api/stationClient.ts` — added `StreamStatus`/`StationTrack`/
  `NowPlayingTrack`/`RecentlyPlayedTrack` types (exact shapes from the
  research above — note `recentlyPlayed` items have no `duration`/`isVideo`
  even though the *web* `PlayerView` references `played.isVideo`; that's a
  latent no-op in the web app itself, not reproduced here), `streamStatus()`
  (`GET /api/stream/status`), `ping()` (`POST /api/stream/ping`), and URL
  builders (`hlsStationUrl`, `hlsLiveAudioUrl`, `libraryStreamUrl`,
  `libraryPreviewUrl`, `libraryArtworkUrl`).
- `mobile/src/player/PlayerEngine.tsx` — new (`.tsx` not the plan's `.ts`,
  same reason as Phase 2's `stationStore.tsx`: it's a Provider, needs JSX).
  One `useAudioPlayer` instance for everything (live audio / station
  rotation / on-demand track / preview); swaps source via `.replace()` only
  when the resolved URL actually changes, and only auto-resumes playback
  across an automatic live↔station swap if the user's play intent was
  already true (tracked via a ref, not `playerStatus.playing` — that lags
  the actual intent by a render). Polls `/api/stream/status` every 10s
  independent of play state. Bearer token (when a listener is logged in)
  is attached via `AudioSource.headers`, not a fetch call — expo-audio's
  native player hits the media URL directly. Exposes `selectTrack`/
  `isPlayableTrack`/`goLive` mirroring the web engine exactly, `openDrawer`/
  `closeDrawer`/`drawerRef` for the bottom sheet, and `bigPlayButtonVisible`/
  `setBigPlayButtonVisible` for `StickyTransportBar`'s visibility rule.
- `mobile/src/components/StickyTransportBar.tsx` — filled in. Visibility:
  `hasStation && (track || nowPlaying) && (!isPlayTab || !bigPlayButtonVisible)`
  — matches web's `StickyTransport` rule (shown on every tab; hidden on Play
  specifically while its own big play button is in view) with one addition
  the web version doesn't need: tapping the bar opens `PlayerDrawer`, since
  mobile has no separate always-visible full-player region to switch to.
  `isPlayTab` comes from `expo-router`'s `usePathname()`.
- `mobile/src/components/PlayerDrawer.tsx` — the bottom sheet, ported from
  `PlayerView.tsx`'s layout (status label, title/subtitle, progress-or-
  levelmeter, play/pause + back-to-live, up-next, recently-played).
- `mobile/src/components/LevelMeter.tsx` — simplified animated bars (see
  scope decision above).
- `mobile/src/screens/PlayScreen.tsx` + updated `(tabs)/play.tsx`.
- Root `_layout.tsx`: added `GestureHandlerRootView` (required by
  `@gorhom/bottom-sheet`, wasn't wired up by any earlier phase),
  `BottomSheetModalProvider`, and `PlayerEngineProvider` (nested inside
  `StationStoreProvider`, since it reads station/listener-auth state).
  Also a dev-only `LogBox.ignoreLogs(...)` for three specific expo-audio
  lock-screen messages — see gotcha below.
- `(tabs)/_layout.tsx`: mounts `<PlayerDrawer />` alongside
  `<StickyTransportBar />`.
- `app.json`: `expo-audio`'s config plugin, registered this phase (`npx
  expo install expo-audio` auto-adds it), given explicit options
  (`microphonePermission: false, recordAudioAndroid: false,
  enableBackgroundRecording: false, enableBackgroundPlayback: true`) — the
  plugin defaults to also requesting
  microphone/recording permissions we never need for a playback-only app,
  which would be an unnecessary store-review/privacy flag.
- New dependencies: `expo-audio` (`npx expo install`, resolved for SDK 57),
  `@gorhom/bottom-sheet` (`npx expo install`).

**Real finding — background audio config is automatic, not manual.**
The original plan (written before confirming expo-audio's actual behavior)
assumed Phase 3 would need to hand-edit `app.json`'s
`ios.infoPlist.UIBackgroundModes` and Android foreground-service
permissions directly. Reading `expo-audio`'s actual config plugin source
(`node_modules/expo-audio/plugin/src/withAudio.ts`) showed it already does
all of that automatically at prebuild time when `enableBackgroundPlayback`
is true (the default) — adds `UIBackgroundModes: ["audio"]`, the Android
`FOREGROUND_SERVICE`/`FOREGROUND_SERVICE_MEDIA_PLAYBACK` permissions, and
registers the media-session service in the manifest. No manual `app.json`
background-audio config was needed beyond the plugin options block above.

**Real finding — Android background playback needs an explicit lock-screen
activation call, not just the permissions.** expo-audio's own docs (read
during implementation, not assumed): without calling
`player.setActiveForLockScreen(true, metadata)`, Android background audio
stops after ~3 minutes regardless of permissions/plugin config. Wired this
into `PlayerEngine`, called once per playback-start (not every status poll
— see bug below) with `updateLockScreenMetadata` for subsequent metadata-
only changes, matching the API's documented usage pattern.

Real-device verification (2026-08-17, same Galaxy A12 as Phase 1/2, over
`adb` + Expo Go) — System.Pape's live directory is still empty (nothing to
select for a real end-to-end test), so temporarily added a `__DEV__`-gated
"[DEV] Use local test station" button to `DiscoverScreen.tsx` pointing at a
locally-run `npm run dev` instance (real station "Rolling Woods", real
broadcast rotation with actual now-playing/recently-played data), tested
against it, then removed the button before finishing (not committed):

- Confirmed live on hardware: real HLS station-audio playback (verified via
  `adb shell dumpsys audio` showing a genuine `AudioFocus` grant with
  `CONTENT_TYPE_MUSIC` for `host.exp.exponent`, not just UI state), real
  `/api/stream/status` polling driving now-playing/up-next/recently-played
  display with actual station data, real listener ping (`listenerCount`
  visibly went 0→1 after pressing play), play/pause toggle, the level meter
  switching between animated (playing) and flat (paused), `PlayerDrawer`
  opening both via `StickyTransportBar` tap and automatically on Play-tab
  focus, `StickyTransportBar` correctly appearing on other tabs (checked
  Stack) with live track info once something is playing, and AsyncStorage
  persistence surviving a full app kill/relaunch (station selection was
  still there after force-stopping Expo Go).
- **Found and fixed two real bugs this way:**
  1. **Lock-screen activation was refiring far more than intended** — the
     original effect called `setActiveForLockScreen` on every dependency
     change (effectively every ~10s status poll, sometimes faster), each
     failed call logging a `console.error`/`console.warn` that popped a
     blocking on-device LogBox redbox — 30+ in a few minutes during testing,
     actually got in the way of driving the UI. Fixed by activating once per
     playback-start (ref-gated) and using `updateLockScreenMetadata` for
     later metadata-only changes, which is also just the architecturally
     correct usage per the API's own docs, not only a noise fix.
  2. **`PlayScreen`'s auto-open-on-focus occasionally no-op'd** — calling
     `engine.openDrawer()` synchronously inside `useFocusEffect` sometimes
     did nothing (drawer host not fully mounted yet right as focus fires).
     Fixed with a 50ms `setTimeout` before calling `present()`; confirmed
     reliable afterward across several repeat focus/blur cycles.
- **Real but *not* fixable from JS — documented instead:** in Expo Go
  specifically, `setActiveForLockScreen`/`updateLockScreenMetadata` always
  fail (`"...service binding failed"` / `"...service not connected"`) —
  Expo Go can't run our config plugin (no prebuild step), so there's no
  Android media-session service for it to bind to. This should **not**
  happen in a real dev-client or production build, where the plugin
  actually ran. Added a narrowly-scoped, `__DEV__`-only
  `LogBox.ignoreLogs([...])` in root `_layout.tsx` for the three exact
  message prefixes this produces, so it doesn't keep interrupting on-device
  testing — deliberately left un-suppressed in the Metro terminal log (only
  the on-device popup is silenced), and if these three messages ever appear
  in a real dev-client/production build, that's a genuine regression worth
  investigating, not something to reflexively re-ignore.
- **True background/lock-screen playback (audio continuing + real lock-
  screen controls after backgrounding/screen-off for several minutes) is
  still unverified** — structurally impossible to verify inside Expo Go
  given the finding above. Needs a real dev-client or EAS build. Worth
  doing before or alongside Phase 8's store-readiness pass, not urgent
  before Phase 4.
- One session hiccup worth recording in case it recurs: at one point mid-
  session the phone showed a solid black screen with `Display Power:
  state=ON` and the app still confirmed resumed/focused (and — per logcat —
  still actively updating Android's AVRCP media-session state, i.e. the JS
  engine was alive) — recovered with a plain force-stop + relaunch, cause
  not conclusively identified (best guess: an ambiguous swipe gesture
  interacting oddly with the bottom sheet's backdrop). A **subsequent**
  `adb shell input keyevent KEYCODE_ENTER` sent to what was assumed to be
  Expo Go's URL field instead landed on the OS and launched Chrome's real
  first-run consent screen — did not interact with it (not an
  authorized-on-the-user's-behalf decision), backed out via the on-screen
  Home button instead. Neither issue reproduced on the next attempt; if a
  future session hits either again, prefer explicit tap-target coordinates
  confirmed via a fresh screenshot over `keyevent ENTER` for text-field
  submission on this device.
- Cosmetic housekeeping: the phone's local AsyncStorage still has "DEV TEST
  STATION" as its persisted station selection from this test pass (harmless
  — overwritten the moment a real station is selected via Discover, and not
  something worth another device round-trip to clear).

Nothing else left open in this phase.

### Phase 3 addendum — Play tab visual refresh
**Status: Done** (2026-08-17)

Prompted by a reference mockup (pink/red gradient player, large artwork,
big pill-shaped controls) given as visual inspiration for the Play tab.
Before touching anything, found an **uncommitted** `mobile/paperweight-new-
design-spec.md` already sitting in the repo (along with new, also-
uncommitted brand-mark assets), never wired into any code — a full
"industrial/oxide" brand spec (ink/surface/raised/paper/concrete/oxide
tokens, small 6-12px radii, explicitly *avoiding* gradients, glow, and
"giant rounded pills") that directly conflicts with the mockup's own look.
Flagged the conflict to the user instead of guessing; they chose the
design spec as authoritative and the mockup as layout-inspiration only.

What was built:
- `mobile/src/constants/theme.ts` — `Colors.light`/`Colors.dark` replaced
  wholesale with the spec's ink/surface/raised/paper/concrete/oxide values.
  `live` now reuses the oxide accent color instead of a separate green —
  matches the spec's own "Color means something is happening" rule (one
  accent for active/live/selected, not a color-per-meaning system). The
  spec only defines one (dark) palette; `light` is a derived inversion
  preserving the same value relationships, since the app still follows
  OS-level light/dark and the spec doesn't say to drop that — flagged in a
  code comment as not spec-sourced, in case a real light-mode spec shows up
  later. Also added a `Radius` export (`sm:6, md:8, lg:10, xl:12`) for the
  spec's "Component Shape Language" section, used in place of the ad hoc
  14-28px radii the mockup-inspired first draft of this pass used.
- `mobile/src/components/PlayerDrawer.tsx` — kept the mockup's information
  architecture (large square artwork, a meta row with title/subtitle, a
  progress element, one centered transport button, up-next/recently-played
  lists) but restyled entirely off the new tokens: artwork frame down to
  `Radius.xl` (was a 28px mockup-inspired radius), icon buttons changed
  from filled circles to transparent/minimal per the spec's "Tertiary/Icon"
  guidance, progress bar thinned to 4px, play button down to 72px oxide
  circle with paper (near-white) icon, up-next/recently-played rows
  restyled as `Radius.md` bordered surface cards instead of bottom-border
  list rows. Now renders real per-track artwork (`libraryArtworkUrl`, with
  bearer-token headers when a listener is logged in) instead of a plain ♪
  glyph swatch, for the main artwork and each row thumbnail — the backend
  route already falls back to a bundled default image server-side, so no
  extra client fallback state was needed. Added a real (non-decorative)
  action in the two slots the mockup used for shuffle/repeat/skip/heart,
  none of which have backing functionality yet: the list icon scrolls the
  sheet to the Up Next section (via a ref + `onLayout`-measured offset),
  and a radio icon appears only when an on-demand track is playing, calling
  the existing `goLive` action. Deliberately did not add shuffle/repeat/
  skip-prev/skip-next or a heart/favorite toggle — no track queue exists
  until Phase 4's Stack catalog, and there is no favorites API on the
  backend at all; decorative no-op buttons were rejected in favor of these
  two real actions.
- `mobile/src/components/StickyTransportBar.tsx` — same token/shape
  treatment (`Radius.xl` container, `Radius.lg` artwork swatch), swapped
  the ♪ glyph for the same real per-track artwork used in the drawer, and
  replaced the ▶/⏸ text glyphs with `Ionicons` for consistency with the
  rest of the icon system.
- Did **not** add `expo-linear-gradient` (the mockup's gradient look is
  moot now anyway under the flat-oxide spec) and did **not** load a custom
  Space Grotesk font: the design spec names it as the primary typeface, and
  the web Studio already self-hosts it (`client/vendor/fonts/space-
  grotesk-latin-*.woff2`), but only `.woff2` is vendored — React Native's
  font loader needs `.ttf`/`.otf`, which would mean sourcing and vendoring
  new font files, a separate follow-up rather than something to fold in
  silently here. System font kept for now.

Verification done:
- `npx tsc --noEmit` and `npx expo export --platform web` — clean, both
  before and after the design-spec pivot.
- Real-device pass (2026-08-17, same Galaxy A12 as prior phases, `adb` +
  Expo Go, targeting the already-running local "Rolling Woods" dev backend
  on `:3001` — reused the exact same `__DEV__`-gated "[DEV] Use local test
  station" pattern from the Phase 3 real-device pass, added to
  `DiscoverScreen.tsx` and removed again before finishing, not committed):
  confirmed on hardware that the light-mode derived palette renders with
  correct contrast everywhere (Discover screen, tab bar, loading spinner
  all show the oxide accent correctly, no invisible-text regressions from
  the token swap), the redesigned drawer renders real station data
  end-to-end (artwork falling back to the bundled default image, status
  caption, title/subtitle, animated level meter in oxide while playing,
  play/pause toggle, listener count incrementing 0→1 on play), and the
  restyled "Recently on air" rows render with real artwork thumbnails and
  the new card styling. Did not re-verify true background/lock-screen
  playback survival (unrelated to this pass, still the same known Expo-Go
  limitation logged under Phase 3 above).
- **Dark mode checked separately** (2026-08-17, same device, toggled via
  `adb shell cmd uimode night yes`): drawer, cards, artwork frame, Discover
  screen, tab bar, and the sticky mini-player all render correctly against
  the ink/surface/raised stack — good contrast throughout, no invisible-
  text or inverted-color regressions. Card borders (`rgba(paper, 0.08)`)
  read as very subtle against near-black, by design (spec: depth from
  value steps, not borders/shadows, on the darkest surface). Restored the
  device to light mode (`uimode night no`) afterward to leave it as found.
- The scroll-to-up-next icon action was tapped on-device but wasn't
  visibly confirmed scrolling in the one attempt made (queue was short
  enough that the auto-scroll target may have been near-zero offset
  already) — logic reviewed and looks correct, just not conclusively
  observed; worth a second look if it ever seems inert with a longer queue.

**Follow-up: made dark the default/only theme**, at the user's request
after the dark-mode check above. The design spec never actually defined a
light mode — `Colors.light` was my own derived addition — so rather than
half-support two themes with no in-app way to choose between them (no
Settings/appearance toggle exists until Phase 7), the app now always
renders dark regardless of the OS setting:
- `mobile/src/hooks/use-theme.ts` — now always returns `Colors.dark`,
  dropping the `useColorScheme()` read entirely.
- `mobile/src/app/_layout.tsx` — `ThemeProvider` now always gets
  `DarkTheme` (expo-router's, for native chrome/back-gesture colors), not
  conditioned on system scheme.
- Deleted `mobile/src/hooks/use-color-scheme.ts` and `.web.ts` — the
  create-expo-app template's OS color-scheme hook, now unreferenced
  anywhere in the app.
- `mobile/app.json` — `userInterfaceStyle: "automatic"` → `"dark"`, and
  the `expo-splash-screen` plugin's `backgroundColor` → `#090909` (was
  `#208AEF`, an unrelated template default) so the native splash matches
  once a real build runs the config plugin. **Confirmed this splash-color
  change has no visible effect in Expo Go** (same class of limitation as
  the expo-audio lock-screen finding under Phase 3 — Expo Go can't run our
  config plugins, so the native splash still shows white there); it should
  take effect in a real dev-client/production build, not verified yet
  since none exists.
- `Colors.light` itself was left in `theme.ts`, unused, in case a real
  light spec or a Settings appearance toggle shows up later — nothing
  currently selects it.

Verified live: force-relaunched the app fresh (killed Expo Go, reopened
via `exp://` — a plain reload wasn't enough, Metro's CI mode caches the
last bundle) on the same Galaxy A12 **with its OS theme still set to
light**, and confirmed the app renders fully dark regardless — Discover,
the "Listening station" card, tab bar, and the sticky mini-player all show
ink/surface/oxide, not the light derivation. `tsc --noEmit` and `expo
export --platform web` both clean after this change too.

Nothing else left open in this addendum.

### Phase 3 addendum 2 — Play tab mirrors the mockup structure, real transport controls, Share card, Posts
**Status: Done** (2026-08-17)

Follow-up request: make the Play tab's layout/structure closely mirror the
reference mockup (not just its color language, already done above), and
make it resize per device. A later message in the same session added:
turn the mockup's placeholder "Song - Album/Collection" pill into a real
Share card, with sliding up from it revealing Up Next / Recently on air /
a new Posts section.

**Structure changes (`PlayerDrawer.tsx`, `StickyTransportBar.tsx` untouched
this pass):**
- Content wrapped in a `maxWidth: MaxContentWidth` (800, already defined in
  `constants/theme.ts` but unused until now), `alignSelf: 'center'` column
  — phones get the same full-width layout as before, tablets/foldables get
  a centered column instead of a stretched-out artwork. `MaxContentWidth`
  was the only piece of "resize per device" that needed new work; the rest
  (percentage widths, `aspectRatio` artwork, `BottomSheetScrollView`
  scrolling for short screens) was already in place from the first pass.
- Meta row gained a real inline "· Back to live" text link in the status
  caption (only when an on-demand track is active) — freed the row's
  right-hand icon slot for a heart/favorite icon matching the mockup's
  position, which stays dimmed/non-pressable (no favorites API exists on
  the backend, see prior addendum's reasoning for the same treatment).
- Progress bar gained a real thumb marker and **tap-to-seek**
  (`engine.seekOnDemand`, new — wraps `expo-audio`'s `AudioPlayer.seekTo`).
  Deliberately tap, not drag: a horizontal drag gesture on a bar living
  inside a `@gorhom/bottom-sheet` risks fighting the sheet's own vertical
  pan gesture, and this repo has already hit real gesture-conflict-shaped
  bugs before (Phase 3's lock-screen/focus timing issues) — tap avoids the
  whole category of risk for a small loss of polish.
- Transport row is now the mockup's full five-across layout (shuffle,
  skip-prev, play, skip-next, repeat), not just the play button. Three are
  real, two are deliberately inert (rendered dimmed, not wrapped in
  `Pressable` at all, so there's no tap target that silently does nothing):
  - **Shuffle** — inert. Rotation order is server/creator-controlled, not
    a listener-facing setting; there's nothing honest for this button to
    do.
  - **Skip prev/next** — real. `recentlyPlayed[0]` / `stationQueue[0]` from
    `/api/stream/status` are already real data with real track `id`s;
    skip now calls `PlayerEngine.selectTrack` on them (via a new
    `toOnDemandTrack` mapper — station-rotation items are safe to treat as
    `visibility: 'public'` since they're already playing on the open live
    stream). This is the first real exercise of `selectTrack` end-to-end
    on real hardware — the "Open decisions carried forward" note from
    Phase 3 flagged this as unverified; it's now verified working
    (confirmed live: switches to on-demand playback, updates title/status/
    progress correctly).
  - **Repeat** — real. New `PlayerEngine.repeatOnDemand` state +
    `toggleRepeatOnDemand()`; when on, a finished on-demand track seeks to
    0 and replays instead of the usual 30s-revert-to-live. Resets to off
    in `goLive()`. Only enabled (non-dimmed) while a track is active —
    repeat has no meaning for live/station audio.
  - Up Next / Recently on air rows are now `Pressable` too (`onPress`
    calls the same `selectTrack` path) — falls out naturally from adding
    real skip prev/next on the same data, and is more useful than leaving
    the rows inert now that tapping a specific track is a real capability.

**New Share card, replacing the mockup's placeholder pill:**
The mockup's "Song - Album/Collection" / "Artist" box is literal
placeholder text in the source image — never a finished part of that
design either. Rather than mirror unfinished mockup content, it's now a
real Share card: "Copy link" (`expo-clipboard`, new dependency — copies
the station's own public URL, the one real "share" pattern that already
exists in this product, mirroring the web Studio's Tools view "copy link"
button) and "Share via…" (`react-native`'s built-in `Share.share` — the
OS share sheet, which *is* "different share options" without hand-rolling
per-platform deep links). Researched `src/api/share.js` first: share-link
*creation* is dashboard/creator-only (`POST /api/dashboard/share`, target
type `track`/`project`) — there is no listener-facing endpoint to mint a
track-specific share link, so a mobile "share this exact track" deep link
isn't buildable without new backend work. Went with sharing the station's
own public URL plus what's currently playing in the message text instead,
which is honest about what's actually shareable today.

**"Sliding up reveals Up Next / Recently on air / Posts":** implemented as
plain document order + the sheet's existing scroll — Up Next, Recently on
air, and the new Posts section sit directly below the Share card, so
scrolling (the same gesture already used for everything else in this
drawer) does exactly what was asked. No nested drag/gesture was added on
top of the bottom sheet's own pan handling — consistent with the
tap-vs-drag call above, and the "reveal" framing works because those
sections were already off-screen below the fold until you scroll. A small
"⌃ Swipe up for more" hint sits under the Share card's two options to
signal this.

**Posts section** (new): `StationClient.listPosts(page, limit)` →
`GET /api/posts` (`src/api/posts.js`) — plain creator text updates, no
media attachments (confirmed from the `creator_posts` migration and
route), server-side tier-gated off whatever bearer token is attached (no
client-side filtering needed). Fetched once per station (`useEffect` keyed
on the station client), first 5 shown. `published_at` comes back as a
SQLite `datetime('now')` string (space-separated, UTC, no zone suffix) —
`formatPostDate` inserts a `T`/`Z` before parsing so it doesn't get
misread as local time.

Verification done:
- `npx tsc --noEmit` and `npx expo export --platform web` — clean.
- Full real-device pass (2026-08-17, same Galaxy A12, `__DEV__`-gated local
  test-station button added and removed again, not committed, same as
  every prior real-device pass): confirmed live — skip-previous switches
  to real on-demand playback of the actual most-recently-played track;
  tap-to-seek jumps to the tapped position (verified exact numbers: tapped
  roughly 69% across a 2:00 track, landed at 1:28, correct within
  measurement error); repeat toggle turns oxide-colored, and a track was
  let play to completion once with repeat on — confirmed it looped back to
  ~0:19 rather than reverting to live; "Back to live" link returns to live
  station playback and resets the repeat toggle; tapping a "Recently on
  air" row switches playback to that specific track (buffering spinner
  shown correctly mid-switch); "Copy link" shows a "Copied" confirmation
  with an oxide checkmark; "Share via…" opens the real Android share sheet
  with the correct message text (`Listening to "howtorollawood" by
  ripsnow & Bud Diaz on DEV TEST STATION — http://10.0…`) and real,
  OS-provided targets (Bluetooth, Gmail, Messages, etc.).
- Posts section verified empty-state only — the local dev "Rolling Woods"
  station has zero rows in `creator_posts` right now. The fetch/render
  code path is the same shape as the already-verified Up Next/Recently
  pattern in this same file, so this is a reasoned-not-observed gap, not
  an unknown; low priority to re-check, but worth doing with real post
  data the next time this file is touched.
- `MaxContentWidth` capping was code-reviewed, not device-verified — no
  tablet/foldable or emulator was available this session, only the one
  physical phone. Low risk (it's a plain `maxWidth`/`alignSelf: 'center'`
  wrapper, nothing dynamic), but flagging since "resize per device" was
  part of the ask and phone-only testing can't fully confirm it.

### Phase 3 addendum 3 — StickyTransportBar polish
**Status: Done** (2026-08-17)

Two small fixes on real-device observation: the mini player's title/artist
text is now centered (`StickyTransportBar.tsx` — `alignItems: 'center'` on
the info column, `textAlign: 'center'` on both text lines), and
`BottomTabInset` (`constants/theme.ts`) was bumped from `{ios: 50,
android: 80}` to `{ios: 70, android: 120}` — the old android value placed
the mini player's bottom edge essentially flush against the tab bar's top
edge (confirmed via the RN inspector overlay on-device: the two rows were
touching, tab labels partly obscured), not floating clear above it as
intended. This constant was always a hand-picked guess, never measured
against a real tab bar — 120 was verified on-device to give clean,
visible separation on the Galaxy A12 (3-button nav); the ios bump is
proportional but unverified (no iOS device available this session).

Verification: `npx tsc --noEmit` / `expo export --platform web` clean;
real-device pass (same Galaxy A12, same `__DEV__`-gated test-station
button pattern, added and removed again) — confirmed centered text and a
clear gap between the mini player and the tab bar on Discover, both
before/after screenshots compared directly.

### Phase 4 — Stack tab
**Status: Done** (2026-08-17)

What was built:
- `mobile/src/api/stationClient.ts` — added `LibraryTrack`/`LibraryProject`/
  `LibraryStructure` types (exact field set from `src/api/library.js`'s
  `formatItem()`), `libraryStructure()` (`GET /api/library/structure`), and
  `downloadUrl(id)` (`GET /api/library/:id/download` — returns `{signedUrl}`
  or `{error}`, never throws, since callers need the error inline the same
  way web's `api.library.downloadUrl` does).
- `mobile/src/player/PlayerEngine.tsx` — `OnDemandTrack` gained `isVideo`/
  `mimeType`/`offlineAllowed` (library items carry more fields than the
  station-rotation items Phase 3 originally typed this for). Added an
  exported `canStash()`, a direct port of
  `studio/src/lib/hooks/usePlayerEngine.ts`'s `canStash`, with one
  deliberate mobile-only narrowing: video tracks are always excluded, since
  Stash only ever downloads/plays local files through `expo-audio` and
  there's no local video player wired up (same "audio only" scope call
  Phase 3 already made for live playback — not silently mis-saving a file
  Stash can't actually play back).
- `mobile/src/stash/stashStore.ts` — new. RN analog of
  `studio/src/lib/hooks/useOfflineSaves.ts`. `canonicalizeBaseUrl()`
  (scheme + lowercased host + non-default port, no trailing slash/path) is
  the load-bearing dedup key the Phase 4 plan flagged — records are keyed
  `${canonicalBaseUrl}::${trackId}` so the same station reached via
  different casing/trailing-slash/manual-URL forms still aggregates
  correctly, without conflating two different stations. Metadata is a
  single JSON blob in AsyncStorage (same pattern as `stationStore`, not
  `expo-sqlite` — the record count here is small); files download via SDK
  57's new `expo-file-system` `File`/`Directory`/`Paths` API
  (`File.downloadFileAsync` into `Paths.document/stash/`, `idempotent:
  true`) rather than the legacy `createDownloadResumable` API the original
  plan assumed, since that's what this SDK version actually ships. Local
  playback uses its own second `useAudioPlayer` instance, kept completely
  separate from `PlayerEngine`'s player — same isolation the web hook keeps
  between its local `<audio>` element and the main engine, so Stash
  playback and live/on-demand playback never fight over one player's state.
- `mobile/src/screens/StackScreen.tsx` — new. Catalog (search + project
  chips that filter the list, ANDed with search) and Stash (records list +
  `storage used` total + per-row remove + "Clear Stash") as two
  `SectionList` sections, avoiding a nested-FlatList-in-ScrollView
  performance trap. No mockup existed for this tab (unlike Play's), so the
  layout follows `DiscoverScreen.tsx`'s established row/chip/search
  conventions rather than trying to mirror `studio/src/views/StackView.tsx`
  pixel-for-pixel — the folder-grid-plus-drawer treatment there is a web-
  specific interaction pattern, not something this port owed a 1:1 copy of.
  Selecting a catalog track calls `stash.stop()` then
  `engine.selectTrack()`; selecting a Stash row calls `engine.pause()` then
  `stash.play()` — same crosstalk both directions the web version has, so
  the two players never play simultaneously. A lock icon shows for
  non-playable tracks (`isPlayableTrack`); a bookmark toggles Stash only
  when `canStash()` is true.
- `mobile/src/app/(tabs)/stack.tsx` — now renders `StackScreen` instead of
  the Phase 1 placeholder, matching Discover's route-level
  `SafeAreaView`-wrapping convention.
- New dependency: `expo-file-system` (`npx expo install`, resolved
  `~57.0.4` — was already present transitively, now pinned directly since
  Stash calls it explicitly).

**Real finding — `canStash`'s offline-eligibility gate is narrower than the
backend's actual download permission**, and this port correctly preserves
that gap rather than "fixing" it: `src/api/library.js`'s `canDownloadMedia`
lets *any* subscriber-tier listener download *any* non-vault track
regardless of `offline_allowed`, but both web's and this port's `canStash`
only show the save affordance when `offlineAllowed` is true (or an unlocked
vault item). Confirmed live via curl against the real dev backend
(subscriber-tier token successfully signed a download URL for a plain
`offline_allowed=0` public track). This is a pre-existing product
inconsistency between client-side affordance and server-side permission,
not something introduced here — mirrored faithfully per the plan's "ports
canStash exactly" instruction, not overridden.

Verification done:
- `npx tsc --noEmit` and `npx expo export --platform web` — clean, both
  before and after real-device testing.
- Live backend smoke test against the real local "Rolling Woods" dev
  server (`:3001`): curled `/api/library/structure` (response shape matches
  the new `LibraryStructure`/`LibraryTrack` types exactly, including a real
  vault track and real project groupings), `/api/library/:id/download`
  unauthenticated (401), with a redeemed subscriber bearer token against a
  track whose stored `filepath` resolves outside the configured
  `VAULT_PATH` (403 "File path is outside the vault" — a pre-existing
  dev-data issue, not a client bug, confirmed by reading `safeVaultPath`'s
  actual comparison against `config.vault.path`), and against a vault track
  the token hadn't unlocked (403 "Vault access required unlockOptions").
  Confirms `stationClient.downloadUrl()`/`stashStore.save()` surface every
  one of these as an inline error rather than throwing.
- **Real-device pass (2026-08-17, same Galaxy A12, `adb` + Expo Go,
  `__DEV__`-gated "[DEV] Use local test station" button added to
  `DiscoverScreen.tsx` and removed again before finishing, not committed)**
  against the real local dev backend on the LAN (`http://10.0.0.11:3001`,
  same machine reached over WiFi rather than the USB-forwarded loopback
  prior phases used, since Stack needed a real routable base URL for
  `expo-file-system` downloads):
  - Catalog: real project chips ("3 EP", "FREE PIERRE 2") and all 8 real
    tracks rendered from the live `/api/library/structure` response; the
    one vault track ("No Hits…") correctly showed a lock icon and its real
    duration (2:44), tracks with `duration: null` in the DB correctly
    showed `--:--` rather than a fake value.
  - Search and the project-chip filter both verified independently and
    combined (ANDed) correctly — typing "krazy" narrowed 8→1, selecting the
    "3 EP" chip narrowed 8→3, both together correctly produced zero with an
    empty-state message, deselecting the chip restored all 8.
  - Selecting a catalog track really calls `PlayerEngine.selectTrack`:
    confirmed a genuine `AudioFocus` grant via `adb shell dumpsys audio`
    when tapping "Rearview," and confirmed the engine's existing
    error-fallback (`goLive(true)` on a playback error) fired correctly and
    reverted to live playback when that track's underlying file turned out
    to be outside the configured vault path (same dev-data issue as the
    curl check above) — a real exercise of that fallback path on-device,
    not just a read of the source.
  - Full Stash round-trip, done by temporarily setting
    `offline_allowed = 1` on one real track (`UPDATE media SET
    offline_allowed = 1 WHERE id = 4`, reverted to `0` immediately after —
    same "harmless, reverted" dev-DB pattern Phase 2 used for its test
    token) and logging in on-device via the real token-redeem flow: bookmark
    icon appeared only once `offlineAllowed` flipped true, tapping it showed
    "Saved for offline playback" and the icon filled in, the Stash section
    correctly showed "1 saved · 2.8 MB" (matching the real source file's
    actual ~2.9MB size), tapping the Stash row's play button produced a
    second genuine `AudioFocus` grant (confirmed via `dumpsys audio`) while
    correctly pausing the live station player first (crosstalk verified,
    not assumed), and removing the record correctly deleted it, dropped the
    Stash count back to "0 saved · 0 MB," reverted the bookmark to unsaved,
    and stopped local playback.
  - Not verified this pass: a second physical station (only one real
    station was available), and Stash aggregation *across* two different
    stations specifically — the per-station canonicalization logic was
    code-reviewed and the single-station save/play/remove round-trip above
    exercises the same code path, but the multi-station de-dup case the
    plan's gotcha calls out is still only verified by reading
    `canonicalizeBaseUrl()`, not by an actual second station.

### Phase 5 — Studio pairing + curated essentials
**Status: Done** (2026-08-17)

**Scope-resolution research, done before writing any code** (the plan
flagged both of these as needing confirmation, not assumption):
- **"Notifications" = the notify-webhook settings, not an event log, not
  native push.** Confirmed by reading the actual product rather than
  guessing: `src/notify/` is fire-and-forget only (CLAUDE.md already says
  so) — there is no `notify_log` table or any persisted history of past
  sends anywhere in the schema. Web Studio's own closest equivalent
  (`SettingsView.tsx`, `button-save-notifications`/`toggle-notify-live`) is
  itself just this settings form, not a history view. So the mobile
  Notifications screen ports that settings form, not an event log that
  doesn't exist.
- **"Release scheduling" has no reference UI anywhere to port** — genuinely
  different from every other Phase 5 item, which all had a real web Studio
  view to port from. Verified: no `release_at` field anywhere in
  `studio/src/` outside one JSDoc comment, no datetime input in the posts
  modal (`AppShell.tsx`'s `modal === 'posts'` block only has body +
  visibility). The backend capability is fully real and wired
  (`media.release_at` + `src/release/scheduler.js` auto-flips visibility;
  confirmed by reading the actual `ALTER TABLE`/scheduler code, not
  assumed) — it's just never had a front-end. Flagged this to the user
  directly (AskUserQuestion) rather than guessing a design; they picked
  "minimal: list + set release_at on tracks," which is what got built —
  see below. `NowPlaying` and `QuickStats` both needed source reading too:
  neither maps to a single web view 1:1 — `NowPlaying` ports
  `studio/src/views/Broadcast.tsx`'s `RotationSection` (not the live
  mic/video broadcast-origination half of that same view, which is a much
  bigger out-of-scope feature — capturing real audio from the phone was
  never in the Phase 5 file list); `QuickStats` ports the Metric-cards +
  weekly-pulse-chart + recent-activity sections of `Overview.tsx`, swapping
  "Catalog size" for "Active subscribers" since the latter is already in
  the earnings response and the former would need a whole separate fetch
  for one number.

What was built:
- `mobile/src/state/studioStore.tsx` — paired-device identity
  (`{baseUrl, deviceToken, deviceLabel, pairedAt}`), persisted via
  `expo-secure-store` (Keychain/Keystore-backed), not AsyncStorage — this is
  a long-lived credential equivalent to the desktop's
  `pw_dashboard_session` cookie, per the plan's explicit instruction.
  Deliberately separate from `stationStore` — pairing authenticates a
  different scope (`requireDashboard`'s bearer flow from Phase 0) than a
  listener's `pw_token` bearer, and a creator might pair Studio without
  that station being their selected "listening" station in Discover.
  `useDashboardClient()` mirrors `stationStore`'s `useStationClient()`
  memoization pattern exactly.
- `mobile/src/api/dashboardClient.ts` — new. `DashboardClient` (bearer
  `Authorization` header, `requireDashboard`-gated routes only:
  broadcast mode/restart/queue/remove, earnings, analytics
  history/activity, settings get/put, media list, media release_at patch)
  plus a bare `redeemDevicePairing()` function — not a `DashboardClient`
  method, since redeeming is how a device gets its *first* token, so
  there's no token yet to attach. Deliberately excludes every
  `requireDesktop`-gated route (tokens, cloudflare, radio-host,
  external-search) — those 403 unconditionally on any non-desktop-platform
  server regardless of auth, confirmed by reading `src/auth/platform.js`,
  so there was never a reason to wire them into a phone client.
- `mobile/src/screens/StudioGate.tsx` — unpaired-state gate:
  `expo-camera`'s `useCameraPermissions()` + `CameraView` with
  `barcodeScannerSettings={{barcodeTypes:['qr']}}`, a denied-permission
  fallback (request again, or `Linking.openSettings()` once
  `canAskAgain` is false), and copy that explicitly frames Studio as an
  optional, desktop-first, creator-only surface — not a dead end — per the
  plan's store-review gotcha. Scanning parses the QR payload as a URL
  (`new URL(data)`, reading `.origin` + the `pt` query param — the QR
  literally *is* `${publicBaseUrl()}/pair?pt=<pairToken>`, confirmed by
  reading `src/api/dashboard.js`'s `POST /devices/pair` and
  `src/runtime/base-url.js`), then calls
  `POST /api/auth/dashboard/device/redeem` and stores the returned token.
- `mobile/src/screens/studio/{NowPlaying,QuickStats,ReleaseScheduling,
  Notifications,DeviceSettings}Screen.tsx` — the five essentials screens
  (scope for each described above). Every screen that hits a
  `requireDashboard` route catches `DashboardClientError` and calls
  `studioStore.signOut()` on a 401, so a device revoked from web falls back
  to `StudioGate` on its next call, per the plan's explicit requirement.
  `ReleaseSchedulingScreen.tsx` filters `GET /api/dashboard/media` to
  `visibility !== 'public'` (scheduling only means anything for tracks
  that aren't already public) and offers five relative-time presets ("In 1
  hour" … "In 1 week") plus "Clear schedule," instead of a native
  date-picker dependency — the user's explicit "minimal" choice, and avoids
  a new native module + iOS/Android picker UI divergence for a first cut.
- `mobile/src/screens/StudioScreen.tsx` — top-level Studio tab: branches
  `StudioGate` (unpaired) vs. a menu → detail-screen pattern (paired),
  using local component state rather than expo-router sub-routes — a
  `src/app/studio/*.tsx` directory would sit in ambiguous overlap with the
  tab's own `(tabs)/studio.tsx` → `/studio` route, so this avoids that risk
  entirely rather than working around it. Android hardware back inside a
  detail screen returns to the menu (`BackHandler`), matching what a real
  back-gesture would do instead of falling through to exiting the tab.
- `mobile/app.json` — added the `expo-camera` config plugin block with
  `cameraPermission` set to an explicit, QR-specific usage string (not the
  generic default) and `microphonePermission`/`recordAudioAndroid` both
  `false` — same "don't request permissions we don't need" discipline as
  Phase 3's `expo-audio` plugin config, since `expo-camera` defaults to
  also requesting microphone access for video recording this app never
  does.
- New dependencies: `expo-secure-store`, `expo-camera` (`npx expo install`,
  both resolved for SDK 57).

Verification done:
- `npx tsc --noEmit` and `npx expo export --platform web` — clean, both
  before and after real-device testing.
- Live backend smoke test via curl against the real local dev server
  (`:3001`) before touching the app: generated a real pairing token
  (`POST /api/dashboard/devices/pair` with the real `DASHBOARD_TOKEN`),
  redeemed it (`POST /api/auth/dashboard/device/redeem`) and confirmed a
  real device token came back, confirmed redeeming the same token twice
  correctly 401s the second time ("expired or already used").
- **Real-device pass (2026-08-17, same Galaxy A12, `adb` + Expo Go).** The
  QR-scanning motion itself can't be exercised in this sandbox (no way to
  physically aim a phone camera at a screen this session controls), so a
  `__DEV__`-gated "[DEV] Simulate QR scan" button was temporarily wired
  into `StudioGate.tsx` — added and removed again before finishing, not
  committed — that fed a *real* pairing URL (a real `pairToken` from a real
  `POST /api/dashboard/devices/pair` call, with the LAN-reachable
  `http://10.0.0.11:3001` origin swapped in for the configured
  `publicUrl`, which turned out to be a stale/misconfigured DNS entry not
  actually tunneled to this sandbox — checked via curl first rather than
  assumed) into the exact same `processScannedUrl()` function a real
  camera scan calls. Only the camera decode step itself is unverified on
  real hardware this session; everything downstream of "a QR was
  successfully decoded" is real, unmodified code, exercised with real
  network calls:
  - Camera permission flow: denial→request dialog verified live (the
    native OS permission prompt), grant confirmed, `CameraView` mounts and
    renders without crashing.
  - Pairing: real redeem call succeeded, `Studio` menu rendered
    immediately with the paired `baseUrl`, all 5 rows with icons.
  - **Now playing**: real rotation state ("howtorollawood" / ripsnow & Bud
    Diaz / shuffle) rendered from live `/api/stream/status`; tapped
    "Switch to scheduled" — confirmed a **real** `POST
    /api/dashboard/broadcast/mode` write via the paired bearer token (mode
    badge flipped to "scheduled" on-device), then switched back to leave
    the station as found.
  - **Quick stats**: real numbers from live `/api/dashboard/earnings` +
    `/api/analytics/history` + `/api/analytics/activity` (listeners now:
    0, this month: $0, listening hours: 0.3h, active subscribers: 0,
    weekly chart Aug 11–Aug 16 with real bars, empty recent-activity
    state) — all genuinely fetched, not placeholder.
  - **Notifications**: loaded real current settings (toggle on, empty
    webhook URL, correct "email not configured" hint), typed a test
    webhook URL, saved, and confirmed via a direct curl to
    `GET /api/dashboard/settings` that the exact string round-tripped to
    the real database — then reverted it back to empty via curl to leave
    the dev DB clean.
  - **Release scheduling**: correctly filtered the real catalog down to
    the 2 actual non-public tracks (6 public tracks correctly excluded).
    Tapped "In 3 days" on a real vault track — **found and fixed a real
    bug this way**: the row showed the raw ISO string
    (`2026-08-20T19:36:56.936Z`) instead of a formatted date. Root cause:
    the optimistic local update stores the client-generated ISO string
    (already zone-suffixed) directly, but `formatReleaseAt` unconditionally
    appended another `Z` — correct for the server's SQLite-format response
    shape (space-separated, no zone) but wrong for the already-ISO
    optimistic value, producing an invalid double-zoned string that fell
    through to the raw-string fallback. Fixed by detecting whether the
    input already has a zone suffix before deciding whether to append one.
    Re-verified live after the fix: correctly showed "Releases Aug 20,
    3:36 PM". Then tapped "Clear schedule," confirmed the row reverted to
    "Not scheduled" live (a real `PATCH .../media/:id` write with
    `release_at: null`).
  - **Device**: correctly showed the paired `baseUrl` and paired-date/
    label; "Sign out this device" correctly cleared local state and fell
    straight back to `StudioGate` (confirmed live, not just by reading the
    code).
- **Not verified this session, two related gaps, both left honestly
  open rather than assumed:**
  1. Whether the paired credential survives a full app **kill**, not just
     an in-session state clear — `expo-secure-store`'s hydration path in
     `studioStore.tsx` is structurally identical to `stationStore.tsx`'s
     already-proven AsyncStorage hydration (real-device verified across
     every earlier phase), so this is a reasoned-not-observed low-risk
     gap, not an unknown mechanism.
  2. The live "revoke from web → next mobile dashboard call 401s → falls
     back to `StudioGate`" check the plan explicitly calls for. Blocked
     this session by the backend's `generalLimiter` (300 req/15min,
     shared across the whole server) — cumulative curl traffic plus this
     same app's own background polling (`PlayerEngine`'s 10s status poll
     never stops, regardless of which tab is focused) used up the budget
     during the rest of this pass's testing. The 401-handling code itself
     is simple and identical across all 5 screens
     (`err instanceof DashboardClientError && err.status === 401 →
     signOut()`) — code-reviewed, not live-traffic-verified. Both gaps are
     good candidates to close opportunistically in Phase 6 or later, once
     a fresh rate-limit window is available.
- `node --test test/devices.test.js` (Phase 0's regression check) — 3/3
  passing, own ephemeral DB, no interaction with the rate-limited dev
  server above.

### Phase 6 — Studio media upload
**Status: Done** (2026-08-17)

What was built:
- `mobile/src/api/dashboardClient.ts` — `upload()` and `uploadArtwork()`, both
  built on `expo-file-system`'s SDK-57 `File.createUploadTask()` (real
  multipart uploads with byte-level progress via `onProgress`), targeting
  the same `POST /api/dashboard/upload` and `POST /api/dashboard/media/:id/
  artwork` routes `studio/src/lib/api.js` already calls — no backend change,
  per the plan. Also added `libraryStructure()` (reuses `stationClient.ts`'s
  `LibraryStructure` type against the same public `GET /api/library/
  structure` route, just for its `projects` list) and
  `addTrackToCollection()` (`POST /api/dashboard/vault/projects/:id/items`).
  `UploadMediaResult`/`UploadMediaParams` types added; both new upload
  methods throw `DashboardClientError` on a non-2xx response, matching the
  rest of the client's error contract.
- `mobile/src/screens/studio/UploadScreen.tsx` — new. Mirrors web Studio's
  upload modal (`AppShell.tsx`) field-for-field: file, title (auto-filled
  from filename, editable), category, visibility, an optional "add to
  collection" pick (from the real project list), and optional cover art —
  same three-call sequence (upload → addTrack → uploadArtwork) with the
  same non-blocking-toast treatment web uses when either optional follow-up
  call fails after a successful upload.
- **No new native dependency was needed for file/image selection.**
  SDK 57's `expo-file-system` (already a dependency since Phase 4) ships its
  own native picker, `File.pickFileAsync({ mimeTypes })`, which returns a
  `File` instance directly — exactly what `createUploadTask` needs. Found
  by reading the installed package's actual `.d.ts` files rather than
  assuming `expo-document-picker`/`expo-image-picker` (the plan's original
  guess) were required; used it for both the main media file
  (`audio/*`/`video/*`) and the optional cover art (`image/*`), same
  "don't add an unverified native dep you don't need" discipline as Phase
  2's dropped `expo-linear-gradient` and Phase 3's dropped custom font.
- `mobile/src/screens/StudioScreen.tsx` — added `Upload` as a new first menu
  item (`cloud-upload-outline`), same menu→detail local-state pattern as
  the other four sections.
- Explicit v1 behavior for the plan's "app backgrounded mid-upload" gotcha:
  a static warning line ("Keep this screen open until the upload
  finishes…") rather than any AppState-driven detection — chosen for the
  same reason Phase 5 chose relative-time presets over a date-picker
  dependency: covers the realistic case without new surface area.

**Real bug found on real hardware, fixed in this same pass:** `UploadScreen`
initially used `Spacing.six` as its `ScrollView` `contentContainerStyle`
bottom padding, matching what looked like the app's existing convention —
but on-device this left the "Add to library" submit button (and the safety
warning above it) partially hidden under the always-present sticky
mini-player (`StickyTransportBar`, which floats over the last
`BottomTabInset` px of every tab). Neither `DiscoverScreen` nor
`StackScreen` surfaced this before now since neither has critical content
at the very end of its scroll. Fixed by adding `BottomTabInset` to this
screen's own bottom padding; confirmed live afterward that both the warning
text and the button clear the mini-player with visible margin. Not fixed
(out of scope for this phase, flagged here instead): `StudioGate.tsx`'s
own error text sits in the same blind spot when a station is actively
selected, since that screen doesn't account for `BottomTabInset` either —
worth a look whenever that screen is next touched.

Verification done:
- `npx tsc --noEmit` and `npx expo export --platform web` — clean, both
  before and after real-device testing.
- **Full live backend smoke test** against the real local "Rolling Woods"
  dev server (`:3001`), exercising the exact multipart shape
  `dashboardClient.ts` sends, before any device involvement: generated a
  real pairing token and redeemed it for a real bearer device token (same
  Phase 0 flow), then `curl -F`'d a real 2.1MB MP3 through
  `POST /api/dashboard/upload` (`category=music`, `visibility=vault`,
  `title=...`) — got back a real `{id, filename, filepath, size, category,
  visibility, title, artist, album}` matching `UploadMediaResult` exactly.
  Followed with a real `POST .../vault/projects/1/items` (confirmed the
  track really appeared in that collection via `GET /api/library/
  structure`) and a real `POST .../media/:id/artwork` with a real PNG
  (confirmed `{ok, artworkUrl}`). All three endpoints work exactly as the
  client calls them. Cleaned up afterward: deleted the test media row and
  its collection membership directly from the dev DB, deleted the artwork
  file from disk, and revoked the test device pairing — dev DB and vault
  left exactly as found.
- **Real-device pass (2026-08-17 night, same Galaxy A12, `adb` + Expo Go):**
  confirmed live — the new Upload menu item renders correctly in Studio;
  the Upload screen renders all fields correctly including a real,
  live-fetched "Add to collection" chip row (`3 EP`, `FREE PIERRE 2` — the
  same two real projects Phase 4 exercised); tapping the dropzone launches
  the real native Android document picker, correctly pre-filtered to
  audio/video (confirmed the OS picker's own "Audio"/"Videos" quick-filter
  chips, and that non-media files rendered greyed-out/unselectable in it);
  the `BottomTabInset` fix above confirmed live, scrolled the sticky bar
  clear of the submit button.
  - **Not completed this pass:** actually selecting a file inside the
    native picker and driving the real submit → progress → success flow
    in the RN UI. Every tap on a file/folder row inside the OS picker's
    list was silently swallowed (no navigation, no selection) even though
    taps clearly worked everywhere else this session (search icon, filter
    chips, back button, and every other screen in the app) — tried grid
    view, list view, and search-result view, and confirmed via
    `uiautomator dump` that tap coordinates landed exactly on the right
    elements. Best guess, not confirmed: a leftover Device-Owner/MDM
    policy from this phone's former life as the unrelated `~/a12` kiosk
    project (see `[[a12-project-paused]]`) silently blocking SAF content
    grants, since general navigation was unaffected. User's call, given
    the time already spent: stop here rather than keep retrying, and rely
    on the backend smoke test (all three endpoints, real data, real
    round-trip) plus the on-device UI/picker-launch verification above as
    sufficient for now. **The actual upload→progress→success round trip in
    the RN UI, and the plan's own required 500MB-over-WiFi and
    real-cellular tests, remain unverified** — pick up with a device that
    doesn't have this restriction, or once this A12's policy state is
    understood.
- All real-device testing used a `.env.local`-based, `__DEV__`-only QR-
  pairing bypass (an `EXPO_PUBLIC_DEV_PAIR_URL` env var read by a temporary
  button in `StudioGate.tsx`) rather than Phase 5's original approach of
  hardcoding a real pairing token directly into the source file — the
  permission system flagged that pattern as credential leakage (a live,
  if short-lived and single-use, token materializing in a tracked,
  on-disk file). `.env.local` is already covered by `mobile/.gitignore`'s
  `.env*.local` rule. Both the source edit and the `.env.local` file were
  fully removed before finishing, same as every prior phase's dev-only
  bypass.

### Phase 7 — Settings modals
**Status: Done** (2026-08-17)

Scope research done first: neither modal had a stubbed entry point yet — the
"gear icon" visible in every screen's top-right corner in earlier phases'
screenshots turned out to be Expo Go's own dev-menu overlay bubble, not app
UI (confirmed by grepping the whole `src/` tree for any settings-icon
render and finding nothing). Phase 7 had to add a real entry point, not
just wire up an existing stub.

What was built:
- `mobile/src/api/stationClient.ts` — widened `me()`'s return type to a new
  `ListenerMe` (the full `GET /api/listener/me` response: email/
  displayName/tier/hasAccount/hasPassword/marketingOptIn/
  subscriptionStatus/currentPeriodEnd/provider/emailVerified/
  emailVerificationRequiredAt/settingsTourSeenAt — confirmed field-for-field
  against `src/api/listener.js`, not guessed) — the client had only typed a
  narrow slice of it before now. Added `resendVerification()`
  (`POST /api/listener/resend-verification`).
- `mobile/src/screens/modals/AppSettingsModal.tsx` — new. Network-override
  section wired to `stationStore`'s `manualBaseUrl`/`setManualBaseUrl`
  (built in Phase 2, had no UI until now) with a save/clear flow and a live
  "Currently using: ‹url› (manual override | from Discover)" readout. Wi-Fi
  section: `expo-linking`'s `sendIntent('android.settings.WIFI_SETTINGS')`
  on Android (a real direct deep link) vs. `openSettings()` on iOS (opens
  the app's Settings page — the platform genuinely doesn't allow a direct
  Wi-Fi-pane link for third-party apps), with copy that says so explicitly
  per the plan's gotcha. **No theme toggle** — the plan's original bullet
  predates the Phase 3 addendum's decision to go dark-only; `Colors.light`
  is unused and there's no real second theme to switch to, so a toggle
  would be a decorative no-op, the same category of control this project
  has consistently avoided (e.g. Play tab's inert vs. real transport
  buttons).
- `mobile/src/screens/modals/AccountSettingsModal.tsx` — new. Read-focused
  account view for the currently selected station: identity + tier badge,
  email-verification status with a resend action, and an access/"tipping
  identity" card (`provider === 'tip'` → "Supporter access from a tip",
  `'stripe'` → "Stripe subscription", else a generic label) with status and
  renewal/end date. Ported a deliberately narrower slice of web Studio's
  `AccountModal.tsx` logged-in branch than the whole thing — marketing
  opt-in toggle, billing portal, cancel-subscription, delete-account/
  profile, and data export are all real, separate destructive/complex
  actions the plan's own scope description ("email verification status,
  supporter tier, tipping identity") doesn't name, and each would need a
  native confirm/prompt equivalent to `window.confirm`/`window.prompt`
  rather than a silent port — left for a deliberate follow-up. Login/
  registration itself stays owned by Phase 2's `ListenerLoginScreen`; this
  screen only handles a device that's already authenticated (guards for
  "no station selected" and "not logged in," the latter linking to
  `/listener-login`). 401s from `me()` clear `listenerAuth` via the store,
  same pattern as Studio's `DashboardClientError` handling.
- `mobile/src/app/app-settings.tsx` / `account-settings.tsx` — new modal
  routes, registered in `_layout.tsx` exactly like Phase 2's
  `listener-login` (`presentation: 'modal', headerShown: true`).
- `mobile/src/screens/DiscoverScreen.tsx` — split the header into its own
  row so a new settings-gear button (→ `/app-settings`) sits top-right next
  to the "Discover" title; the "Listening station" card's action button now
  reads "Account" (→ `/account-settings`) instead of "Log in" once
  `listenerAuth` is set, falling back to "Log in" (→ `/listener-login`,
  unchanged) otherwise — a small conditional on existing state, not a new
  concept.

**Gotcha hit and worked around:** `typedRoutes: true` means `router.push('/app-settings')` only typechecks once expo-router's generated `.expo/types/router.d.ts` includes the new route files — and that file is only regenerated by the interactive Metro dev server (`expo start`), not by `expo export`, which bundles fine off stale types without erroring. `tsc --noEmit` failed after adding the two new routes until a brief `expo start --web` pass regenerated the types file; worth remembering next time a new route file causes a confusing "not assignable" typed-routes error that `expo export` alone doesn't reproduce or fix.

Verification done:
- `npx tsc --noEmit` and `npx expo export --platform web` — clean, both
  before and after real-device testing (13 static routes now, the 2 new
  modals included).
- **Live backend smoke test** against the real local dev server (`:3001`)
  before touching the app: registered a real throwaway listener account,
  inserted a real `provider: 'tip'` active subscription row directly (same
  controlled-test-data pattern prior phases used), and confirmed
  `GET /api/listener/me` returns exactly the `ListenerMe` shape the client
  now types, including `tier: "subscriber"` and `provider: "tip"` once the
  subscription existed. Also confirmed `POST /api/listener/resend-
  verification` returns `{ok:true, emailEnabled:false}` against this
  station (no SMTP configured in dev). Cleaned up the test account,
  profile, tokens, and subscription row directly from the dev DB
  afterward — verified `listener_accounts` back to just the one pre-existing
  real row.
- **Real-device pass (2026-08-17 night, same Galaxy A12, `adb` + Expo Go)**
  — confirmed live:
  - The new settings gear renders in Discover's header and opens
    `AppSettingsModal`. **Found (not a bug, just a dev-only nuisance worth
    recording):** Expo Go's own floating dev-menu bubble docks in the exact
    same top-right corner as this new button, fully overlapping it — had to
    drag the bubble aside first to reach the real button underneath. Purely
    a development-mode collision (that bubble doesn't exist in a real
    build); not something to design around, just a testing note for next
    time.
  - Network override: typed a fake URL, "Save override" correctly updated
    the "Currently using" readout to show it with "(manual override)" and
    revealed a "Clear" button; "Clear" correctly reverted the readout to
    the real discovered station URL and hid itself again — both the
    underlying `stationStore` state changes and their live reflection in
    this same screen's own readout confirmed, not just the individual
    button taps.
  - Wi-Fi: "Open Wi-Fi settings" launched Android's real system Wi-Fi
    settings screen (confirmed actual nearby network names rendered, not a
    stub) — a genuine `sendIntent` deep link working end-to-end, not just
    code-reviewed.
  - Account: with a stale leftover listener token from earlier-phase
    testing still persisted on this device, opening the modal correctly
    exercised the real 401-then-clear path live (fetch failed, `listenerAuth`
    cleared, Discover's button flipped from "Account" back to "Log in" —
    all observed, not assumed) before any fresh login happened. Then logged
    in fresh through Phase 2's real `ListenerLoginScreen` UI against the
    throwaway test account (with the tip-subscription row) and confirmed
    the full logged-in view: real email, "SUBSCRIBER" tier badge, "Email
    not verified yet" with a working "Resend" button (confirmed via a live
    notice string after a real network call), "Supporter access from a
    tip" with the correct real renewal date, and "Log out" correctly
    clearing the session (confirmed via Discover's button reverting) —
    verified via `uiautomator dump` bounds after the layout shifted from a
    notice-text disappearing pushed the button up, since a first
    coordinate-guessed tap missed and initially looked like a broken
    button but was actually just an aim error on this pass's part.
- Not verified this pass: iOS's `openSettings()` fallback for the Wi-Fi
  button (no iOS device available this session, same limitation noted
  throughout this project) — code matches the documented iOS behavior of
  `expo-linking`'s `openSettings()`, not device-confirmed.

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
- Real-device verification for Phase 3 is done (see that phase's log) with
  one deliberate gap: true background/lock-screen playback survival can't
  be verified inside Expo Go at all (it can't run our config plugin) — that
  needs a real dev-client or EAS build, worth doing before or alongside
  Phase 8, not urgent before Phase 4.
- On-demand track playback (`PlayerEngine.selectTrack`/`isPlayableTrack`)
  was exercised end-to-end on real hardware in Phase 4 (see that phase's
  log) — confirmed working (real `AudioFocus` grant) and confirmed its
  error-fallback path works too, not just the happy path.
- Stash's cross-station aggregation (Phase 4) is implemented and the
  single-station save/play/remove round-trip is real-device verified, but
  aggregating Stash across two *different* physical stations specifically
  is still only code-reviewed, not device-verified — only one real station
  was reachable this session. Low priority to chase down alone; verify
  opportunistically if a second real station is ever available anyway.
- Phase 5's paired-device credential surviving a full app **kill** (not
  just an in-session sign-out/state clear) is unverified — reasoned as
  low-risk since `studioStore.tsx`'s `expo-secure-store` hydration is
  structurally identical to `stationStore.tsx`'s already-proven
  AsyncStorage hydration, but worth an explicit kill+relaunch check next
  time this device is in hand.
- Phase 5's live "revoke a paired device from web → next mobile dashboard
  call 401s → falls back to `StudioGate`" check (explicitly required by
  the Phase 5 plan) was blocked by the backend's `generalLimiter`
  (300 req/15min, shared server-wide) during that pass's own testing —
  code-reviewed (identical `DashboardClientError.status === 401 →
  signOut()` handling in all 5 Studio screens) but not live-verified.
  Revisit once a fresh rate-limit window is available, ideally before
  relying on this fallback in front of a real user.
- Phase 6's actual upload round trip (select a real file on-device → submit
  → progress → success) is unverified — the physical Galaxy A12's native
  file picker silently swallowed every tap on a file/folder row this
  session (see Phase 6 log for the full investigation), most likely a
  leftover Device-Owner/MDM restriction from that phone's former life as
  the `~/a12` kiosk project. The backend itself is fully verified (real
  curl round trip through all three endpoints — upload, add-to-collection,
  artwork — with real data). Needs either a device without this
  restriction, or that restriction understood/cleared, before the plan's
  own required 500MB-over-WiFi and real-cellular tests can run.
- `StudioGate.tsx`'s error text can end up in the same blind spot
  `UploadScreen` hit and fixed (Phase 6): it doesn't add `BottomTabInset`
  padding, so a pairing-error message could render partly behind the
  sticky mini-player when a station is already selected. Not fixed here
  (out of Phase 6's scope) — worth a one-line fix whenever that screen is
  next touched.
