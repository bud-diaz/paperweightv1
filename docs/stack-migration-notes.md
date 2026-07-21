# Stack / Stash migration notes

## Existing DOM and JavaScript contract

- `client/creator.html` owns only the fixed shell: `#panel-stack > #stack-sections`. All section, folder, row, and action markup is created by `client/js/stack.js`.
- `ensureCards()` mounts the two `.stack-card` sections once. `makeCard()`, `applyAccordion()`, and `setCardOpen()` own top-level open state, `.open`, and `aria-expanded`.
- `renderStack()` targets `[data-stack-key="stack"] .stack-card-content`; `refreshStash()` targets `[data-stack-key="stash"] .stack-card-content`.
- `makeFolder()` owns `.stack-folder`, `.stack-folder-head`, `.stack-folder-body`, `.stack-tree`, and per-project open state.
- `makeTrackRow()` owns `.stack-row`, its access-state variants, `.stack-row-main`, `.stack-row-title`, `.stack-row-meta`, `.stack-row-actions`, `.stack-btn-queue`, and `.stack-btn-stash`.
- `refresh()` reloads quota and the IndexedDB saved-id set, then rerenders both sections. `initStackView()` mounts and refreshes the view when the Stack tab opens.
- No other JavaScript module queries `.stack-card`, `.stack-row`, or `#stack-sections`. `main.js` calls `stack.refresh()` after library/player changes and `stack.initStackView()` on Stack-tab entry.

## Data mapping

- Stack content comes from the existing `LIBRARY_STRUCTURE.projects` and `.standalone` response from `GET /api/library/structure`; no response shape changes are required.
- Effective access uses the existing normalized `visibility`, `unlocked`, `offlineAllowed`, creator mode, and listener tier fields.
- Stash membership and records come exclusively from `offline.js` (`savedIds()`, `listSaved()`, `saveTrack()`, and `removeSaved()`), backed by the existing `paperweight-offline` IndexedDB store.
- Settings -> Collection already reads and writes that same IndexedDB store. The two renderers need callback-based refresh wiring so a mutation in either surface immediately updates the other.

## CSS and layout changes

- Preserve the existing row, folder, action, and typography selectors. Add the mockup's card flex sizing, stable Stack/Stash order, header badges, collapsed summaries, tier chips, and recent-save strip.
- Replace outer-panel scrolling with `#panel-stack { overflow: hidden; }`. The open `.stack-card-body` becomes the only vertical scroll container; the closed body remains mounted in the DOM but is removed from layout so scroll content cannot inflate the header-only card.
- Replace JavaScript-measured body heights with `.open` class changes and CSS flex growth. Exactly one card remains open, with Stack as the initial state.

## Intentional mockup divergences

- Redacted vault rows show a Vault chip only; the mockup's fake duration/category placeholders are omitted so no metadata is implied.
- The vault affordance is the text button `UNLOCK`, wired to the existing vault tip/payment gate instead of the mockup glyph.
- Recent saved artwork uses a neutral placeholder because offline records do not persist artwork. The markup can accept artwork later without changing Stash persistence.
- Stash is the real browser-local offline library, not demo or server-side placeholder data.
- Supporter-locked rows retain the existing subscription action on row click and cannot be queued or stashed until access makes them playable/saveable.
- STASH actions are listener-only. In creator mode, each Stack row receives an EDIT action that opens the authoritative Studio -> Vault track editor; no duplicate metadata form is rendered in Stack.
