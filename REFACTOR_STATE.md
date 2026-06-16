---
# Refactor State
phase: 3
status: complete
last_completed: Phase 3 - API module (api.js)
notes: |
  Phase 1: Extracted 992 CSS lines from creator.html <style> block into four
  files under client/css/. Replaced <style> block with four <link> tags.

  Phase 2: Created two ES module foundation files under client/js/:
  - client/js/state.js (113 lines): all module-level globals
  - client/js/utils.js (54 lines): pure stateless helpers

  Phase 3: Created client/js/api.js — structured fetch layer.
  All 50+ fetch/dashFetch call sites are represented as named functions.
  No state.js imports needed (all auth uses httpOnly cookies).
  Internal helpers: _fetch, _json, _send, _del (not exported).

  Endpoints with INCONSISTENT or RISKY error handling (Phase 7 risks):

  1. GET /api/vault/unlock-options/{id} (line 2037)
     — On fetch failure, returns false. Calling code (checkVaultGate) cannot
       distinguish "no vault gate needed" from "fetch failed" — it silently
       continues as if no gate exists. Risk: vault content exposed on transient error.

  2. GET /api/payment/checkout-url (lines 1987 + 2101)
     — Called twice with different error handling. Line 1987 (tip CTA):
       removes processing class on error and shows inline error element.
       Line 2101 (vault gate subscribe btn): removes processing class only.
       Neither shows the user a useful message on failure. Risk: silent failure.

  3. POST /api/dashboard/live/chunk (line 4414)
     — No error handling at all: try { await dashFetch(...); } catch {}
       Silently drops failed audio chunks. Risk: encoder sync issues / silent
       broadcast gaps with no UI feedback.

  4. POST /api/dashboard/2fa/confirm (lines 4256-4276)
     — Returns { recoveryCodes } that must be displayed once and saved.
       On parse failure the codes are lost. No retry path. Risk: user locked
       out if network hiccup swallows the response.

  5. POST /api/dashboard/tokens (line 3717) — global token creation
     — Token is in data.token, displayed once. If the page navigates or
       re-renders immediately after creation the token is lost. Low risk
       (controlled UI flow) but worth noting.

  6. GET /api/dashboard/external-search (line 3919)
     — No distinction between "API key not configured" and actual errors;
       both show generic 'Search failed.' Risk: confusing UX.

  Globals excluded from state.js (carry-over from Phase 2 notes):
  - uploadZone / uploadInput: DOM-cached refs with import-time side effects
  - WORKLET_CODE: embedded AudioWorklet source; candidate for future live.js
  - normalizeTrack: pure domain transform; candidate for future library.js
---
