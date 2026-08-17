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
| 4 | Stack tab: catalog + cross-station Stash | ⬜ Not started |
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
**Status: Not started**

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
- Real-device verification for Phase 3 is done (see that phase's log) with
  one deliberate gap: true background/lock-screen playback survival can't
  be verified inside Expo Go at all (it can't run our config plugin) — that
  needs a real dev-client or EAS build, worth doing before or alongside
  Phase 8, not urgent before Phase 4.
- On-demand track playback (`PlayerEngine.selectTrack`/`isPlayableTrack`)
  is implemented but has never been exercised by any real UI or test yet —
  there's no track-selection surface until Phase 4's Stack catalog exists.
  Sanity-check it end-to-end as soon as Phase 4 wires a real call site,
  rather than assuming the port from `usePlayerEngine.ts` is correct purely
  because it typechecks.
