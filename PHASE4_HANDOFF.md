# Phase 4 handoff — creator.html → Studio cutover

Working note for continuing the `client/creator.html` → `studio/` frontend migration.
Delete this file once Phase 4 ships (it's a handoff aid, not permanent documentation —
`CLAUDE.md`'s "Creator Studio (`studio/`)" section is the permanent record and should be
updated in its place once the cutover lands).

Branch: `claude/creator-html-paperplate-migration-eqbax9` (repo `bud-diaz/paperweightv1`).
Working tree is clean as of this handoff; latest commit is
`a37cd7c studio: Phase 3 Tier 4 — real offline saves (stash) + settings tour`.

## Status: Phases 0–3 are done. This is Phase 4 only.

The full plan (5 phases) lives in the original plan-mode document; the short version:

- **Phase 0** — scaffolded `studio/` (Vite + React + TS + Tailwind + shadcn/radix), built to
  `client/app/`, served side-by-side at `GET /studio` while `client/creator.html` keeps working
  unmodified. Done.
- **Phase 1** — real dashboard auth (login/2FA/device pairing) and real listener auth shell.
  Done.
- **Phase 2** — creator dashboard fully wired to real data across all nav views (Overview,
  Activity, Releases, Vault, Broadcast, Analytics, Earnings, Profile, Tools, Security,
  Settings), plus upload/collection-creation/vault-pricing/share-link-creation/live-broadcast
  as later sub-features. Done — see commits `0069a83`..`273f390`.
- **Phase 3** — the public listener/player experience (Stack/Play modes), built in 4 tiers,
  all done and Playwright-verified against the real backend:
  - Tier 1 (`e89bf13`): `ListenerShell` architecture, `usePlayerEngine` (live HLS station
    playback, separate from on-demand), welcome overlay, posts ticker.
  - Tier 2 (`c8d6b2f`, `b224d38`): full listener identity (login/register/password
    reset/email verify/auto-login/account management via `ListenerAuthContext`), on-demand
    track playback + quota (`GET /api/library/stream-quota`, 30s gated previews, next-up
    arming).
  - Tier 3 (`d35ed05`): monetization checkout — tip/subscribe/all-access (`CheckoutModal`)
    and vault unlock (`VaultGateModal`), `?tipped=1` thank-you state.
  - Tier 4 (`a37cd7c`): real offline saves/stash (IndexedDB, `useOfflineSaves`) and the
    one-time Settings tour spotlight (`SettingsTour`).

**Explicitly deferred, not blocking cutover** (per the plan's own priority order, reaffirmed
in the Tier 4 commit): the ASCII terminal/video canvas renderer (`client/js/ascii.js`) and
mouse/device-orientation tilt (`client/js/tilt.js`). Both are decorative canvas effects tied
to the old design's specific DOM surface; the new design has its own visual language and
doesn't call for a literal port. Do not treat their absence as a cutover blocker unless the
user says otherwise.

## Phase 4 scope (from the original plan)

> Once both checklists are fully wired and manually verified, point `/creator.html` at the
> new build, retire the old `client/js/*.js` and `client/css/*.css` files, and retire or
> replace `scripts/check-dashboard-contract.js` — it hard-asserts the *old* HTML's exact
> DOM-id count and becomes meaningless once that file is gone; remove it from the
> `release:check` chain in `package.json` or replace it with an equivalent contract check
> for the new app.

Verification called for: full `npm run release:check`, plus `npm run smoke` and
`npm run smoke:exe` against a packaged build to confirm `client/app/` assets are correctly
embedded via `src/client-bundle.js` and served identically in packaged/Electron mode.

## Routing research already done this session (not yet acted on)

Read `src/index.js` end to end for the routing picture. Key facts, so the next session
doesn't have to re-derive them:

- `sendCreatorHtml(res)` (`src/index.js:221`) is the function that currently serves
  `client/creator.html`. It checks, in order: a runtime override at
  `config.paths.root/client/creator.html` (lets self-hosted users override the frontend next
  to the executable — this override mechanism matters for Electron/packaged installs, don't
  drop it), then the packaged JS bundle (`src/client-bundle.js`'s `/creator.html` entry) when
  `isBundledRuntime`, then the on-disk app file. This exact same three-tier precedence
  already exists for the *new* app's entry point — see the `/studio` route
  (`src/index.js:331`), which does the identical override → bundle → disk lookup but for
  `client/app/index.html` / bundle key `/app/index.html`.
- `client/` has **no** `index.html` of its own (only `creator.html`, `embed.html`,
  `pair.html`), so `GET /` is never served by the static-file middleware — it falls through
  to the final catch-all `app.get('*', ...)` at `src/index.js:442`, which calls
  `sendCreatorHtml(res)`. `GET /creator.html` *is* a literal file, so in non-bundled mode it's
  actually served directly by `express.static` before ever reaching `sendCreatorHtml` (same
  bytes either way today, but worth knowing when repointing things).
- Three call sites currently route to the old frontend via `sendCreatorHtml()`:
  1. `app.get(['/', '/creator.html'], ...)` at `src/index.js:273` — **only registered when
     `devReload` is on** (`PAPERWEIGHT_DEV_RELOAD=true`). In normal/production mode this pair
     isn't explicitly registered; `/` reaches it via the catch-all instead (see above) and
     `/creator.html` reaches it via static-file serving instead.
  2. `app.get('/share/:token', ...)` at `src/index.js:438` — share-link landing page.
  3. The catch-all `app.get('*', ...)` at `src/index.js:442` — SPA fallback for
     `/` and any unmatched non-API/non-hls path.
- **Gap found, not yet fixed**: the new `studio/` app's router (`studio/src/App.tsx`) only
  defines one route, `path="/"` → `AuthGate`. There is **no** client-side route for
  `/share/:token` yet. `client/js/` presumably reads the token client-side once
  `creator.html` loads (worth confirming exactly how, e.g. `client/js/share.js` if it
  exists) and unlocks a share-scoped view. Cutting `/share/:token` over to serve
  `client/app/index.html` without first adding an equivalent studio-side route (reading the
  token from `window.location.pathname`, same trick already used for `?tipped=1` query params
  and `#verify=`/`#autologin=`/`#reset=` hash links in `EmailLinkHandler.tsx`) will silently
  break share links. **Check `client/js/` for the vanilla share-link flow and port it before
  repointing `/share/:token`.**
- `/embed` (`client/embed.html` + `client/js/embed.js`), `/pair` (`client/pair.html` +
  `client/js/pair.js`), and `/feed.xml` + `/feed/enclosure/:id` are separate, self-contained
  entry points that don't go through `sendCreatorHtml()` at all — **out of scope**, don't
  touch them, just confirm the cutover doesn't accidentally shadow them (it shouldn't, since
  they're registered as their own explicit routes before the catch-all).

### Suggested cutover shape (not yet implemented — a starting hypothesis, verify before committing to it)

The lowest-risk repointing is probably: keep `sendCreatorHtml()`'s three-tier override/
bundle/disk precedence exactly as-is, but change what it points at — either rename it to
serve `client/app/index.html` (mirroring `/studio`'s route body), or extract that lookup into
a shared helper both `/studio` and the catch-all/`/` /`/creator.html` routes call. Decide
whether `/creator.html` and `/studio` should become aliases of the same content (probably
yes, for old bookmarks/links) or whether `/creator.html` should 301-redirect to `/`. Whichever
is chosen, keep the runtime-override path working (`config.paths.root/client/app/index.html`
already exists for `/studio` — reuse it, don't invent a second override location).

## Old-file retirement checklist

Once the new build is confirmed serving `/` correctly end-to-end (dashboard **and** public
listener paths, plus `/share/:token` once fixed):

- Delete `client/js/*.js` (all ~40 files, including the 24 under `client/js/dashboard/`) and
  `client/css/*.css`.
- Delete `client/creator.html` itself once nothing references it.
- Regenerate `src/client-bundle.js` (`node scripts/generate-client-bundle.js`) after deleting
  — it will stop embedding the removed files automatically since it walks the `client/`
  directory tree.
- `scripts/check-dashboard-contract.js` reads `client/creator.html` and
  `client/js/dashboard/*.js` directly — it will hard-crash (not just fail) once those are
  gone, since it does `fs.readFileSync` with no existence guard. Remove its invocation from
  `release:check` in `package.json` (`scripts/check-dashboard-contract.js` is currently listed
  there — see `package.json:29`) and either delete the script or repurpose it as an equivalent
  contract check for the new app (e.g. asserting every `data-testid` referenced by
  `studio/src/**` actually exists in the built output — optional, not required by the plan).
- Search for any other stray references to the deleted files before removing them
  (`grep -rn "client/js/" --include=*.js src/ scripts/` and similar) — e.g.
  `scripts/generate-client-bundle.js`'s MIME map, `scripts/check-package-assets.js`, and
  `electron/` may reference specific paths.
- Re-run `npm run check:package` after deletion — it has hardcoded required-file assertions
  that may need updating if any pointed at now-removed files (unlikely based on this
  session's read of it, but verify).

## Verification methodology established across Phases 1–3 (reuse for Phase 4)

- **Sandbox has no ffmpeg/ffprobe or Stripe/PayPal configured.** This is expected, not a bug:
  live broadcast encoding, upload transcoding, and preview generation don't work here, but
  direct file streaming (`GET /api/library/:id/stream`, `/download`) does, since that's a
  plain `res.sendFile()`/signed-URL path with no ffmpeg involved. Stripe-dependent endpoints
  correctly 503 with "Stripe not configured on this server" — verify the new/repointed UI
  surfaces that gracefully rather than hanging or throwing.
- **Starting the dev server without a `.env`**: `PAPERWEIGHT_ALLOW_MISSING_ENV=true node
  src/index.js` (backgrounded). Don't bother with `scripts/setup.sh` (interactive) in this
  sandbox.
- **Seeding test media**: no ffprobe means the vault scanner can't auto-index files dropped
  into `vault/`. Generate a minimal real WAV file with pure Node (manual RIFF/WAVE header,
  see any of this session's `node -e "..."` WAV-writer calls in prior commits' verification
  history) and insert the `media` row directly via `better-sqlite3` pointing `filepath` at it
  — gets genuine 200/206 responses instead of mocking the network layer.
- **Playwright**: launch Chromium at
  `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` with `--no-sandbox` (add
  `--autoplay-policy=no-user-gesture-required` for anything that plays audio programmatically,
  `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream` + context
  `permissions: ['microphone','camera']` for anything mic/camera-related). Run via
  `NODE_PATH=/opt/node22/lib/node_modules node <script>.js`, wrapped in
  `timeout 55 ...` (40s was too tight in one earlier run and produced a misleading
  "Target page, context or browser has been closed" from the timeout killing the browser
  mid-run, not a real app bug — if that happens again, just raise the timeout, don't chase it
  as a bug). Screenshots to the scratchpad dir, then actually `Read` them back to look —
  network-log assertions alone missed nothing this migration, but reviewing screenshots is
  what caught real UI-state questions worth double-checking.
- **Cleanup after every verification pass**: kill the backgrounded server, `rm -rf
  data/paperweight.db data/paperweight.db-* data/upload_tmp hls_output` plus any seeded
  `vault/` test files, confirm `git status --short` is clean of test artifacts before
  committing real changes.
- **Before every commit**: `npm test` (was 204/204 passing at every checkpoint this
  migration — if that number moved, something regressed) and `npm run check:package`.
  `npm run build:studio` (or `cd studio && npm run build`, they're equivalent) regenerates
  `client/app/`; `node scripts/generate-client-bundle.js` regenerates `src/client-bundle.js`
  from whatever's currently in `client/` — always run both, in that order, before committing
  studio changes.

## Git workflow reminders

- Branch: `claude/creator-html-paperplate-migration-eqbax9`. Never push elsewhere without
  explicit permission.
- Push with retry: `git push -u origin claude/creator-html-paperplate-migration-eqbax9`,
  retry up to 4x on network failure with exponential backoff (2s/4s/8s/16s) — see this
  session's git-push calls for the exact loop.
- Regular commits, not amends. No `--no-verify`, no force push, no `git add -A`/`git add .`
  (name files explicitly).
- Commit message style established this migration: one-line summary in the
  `studio: Phase N ...` (or `studio: wire ...` for standalone sub-features) form, blank line,
  then a few paragraphs on *what* and *why*, explicitly calling out any deliberately-preserved
  pre-existing backend quirks or deliberately-deferred scope, closing with a short note on how
  it was verified. See any commit from `0069a83` through `a37cd7c` for the exact tone/format
  to match.
- Do not create a PR unless explicitly asked.
