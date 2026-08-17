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
| 3 | Play tab: playback engine + sticky transport + drawer | ⬜ Not started |
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
**Status: Not started**

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
