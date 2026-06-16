---
# Refactor State
phase: 2
status: complete
last_completed: Phase 2 - Foundation Modules (state.js + utils.js)
notes: |
  Phase 1: Extracted 992 CSS lines from creator.html <style> block into four
  files under client/css/. Replaced <style> block with four <link> tags.

  Phase 2: Created two foundation ES modules under client/js/:

  client/js/state.js — 113 lines
    All module-level globals from the inline script, grouped by concern.
    Named exports, no side effects on import.

  client/js/utils.js — 54 lines
    Pure helpers with no state imports. PALETTE duplicated locally to keep
    utils.js fully dependency-free.

  Globals excluded from state.js (noted ambiguities):

  1. uploadZone / uploadInput (const refs to DOM elements, lines 3541-3542)
     — call el() at declaration time → import-time side effects.
     — Not suitable for state.js; must remain inside an init function.

  2. WORKLET_CODE (const string, line 4313)
     — Embedded AudioWorklet source, not mutable state.
     — Included in state.js for now; candidate for a future live.js module.

  3. normalizeTrack(item) — pure data-transformation but domain-specific.
     — Not included in utils.js (not a general utility).
     — Candidate for a future library.js module.

  4. drawAsciiArt / drawWaveBars / drawAudioCard / drawVideoAscii
     — Canvas renderers that close over ASCII state globals.
     — Not stateless; belong in a future ascii.js module.

  Phase 2 design note:
  The current code reassigns `state` entirely: `state = { ...state, track: t }`.
  ES module live bindings are read-only from importers. Before Phase 8 wiring,
  all object-replacement assignments must change to Object.assign(state, { ... }).
  Same applies to: LIBRARY, LIBRARY_STRUCTURE, authState, and other exported lets
  that get fully replaced rather than mutated.
---
