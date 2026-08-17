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
| 1 | `mobile/` workspace scaffold + tab shell + CI | ⬜ Not started |
| 2 | Discover tab: System.Pape + current-station + listener login | ⬜ Not started |
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
**Status: Not started**

Before writing any screens, these need to be pinned explicitly (see
implementation plan's "Decisions to pin at Phase 1 kickoff"):
- Expo SDK version (drives `expo-av` vs `expo-audio`, camera API,
  background-audio config in later phases)
- Navigation library (Expo Router vs React Navigation)
- Bottom-sheet library for the Play drawer
- EAS Build / code-signing strategy

### Phase 2 — Discover tab
**Status: Not started**

Pre-phase spike required first: confirm System.Pape's `/stations` and
`/directory` are production-stable, not just the "Proposed" parts of
`docs/system-pape-contract.md` / `docs/system-pape-directory.md`. This is a
hard blocker for the whole phase if unresolved.

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

- Expo SDK version, navigation library, bottom-sheet library, EAS/signing
  strategy — all still unresolved, blocking Phase 1.
- System.Pape `/stations` / `/directory` production-readiness — unresolved,
  blocking Phase 2.
