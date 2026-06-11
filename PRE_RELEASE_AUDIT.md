# Pre-Release Audit & Implementation Plan

**Date:** 2026-06-11
**Scope:** Final audit before compiling Windows executables.
**Status:** Open — handoff document for next implementation session.

---

## How to use this document

This file is a self-contained handoff. A fresh agent (or developer) should be able to pick up cold and execute the plan without re-running the audit.

1. Read **Severity-Ranked Bug List** to understand what was found.
2. Execute **Implementation Plan** stage by stage. Each stage lists files, exact changes, and a verification step.
3. Stages 1–4 are **mandatory** before shipping. Stage 5 is high value but not strictly blocking.
4. Update this file as bugs are fixed: mark items ✅ in the table and add notes in the **Patch Log** at the bottom.
5. Run the **Final Gate** before compiling the executable.

**Methodology of the original audit:** Five parallel sub-agents reviewed (1) auth/payment/webhook security, (2) DB and scanner subsystem, (3) broadcast engine and FFmpeg, (4) the single-file `client/creator.html` frontend, and (5) API routing and packaging readiness. Findings were de-duplicated and pruned of low-confidence noise.

---

## Severity-Ranked Bug List

### 🔴 SHIP-BLOCKERS (must fix before compiling)

| ID  | Status | Bug | Location |
|-----|--------|-----|----------|
| B1  | ✅ | Webhook signature verified **after** DB dedup lookup — leaks event-ID existence to unauthenticated callers | `src/api/payment.js:574-600` |
| B2  | ✅ | 2FA challenge consumption non-atomic — same challenge can be redeemed twice concurrently | `src/api/auth.js:37-98` |
| B3  | ✅ | No rate limit on `POST /api/tokens/redeem` — allows brute-force of redemption tokens | `src/api/tokens.js:17-33` |
| B4  | ✅ | `scripts/smoke-exe.js` not in `pkg.scripts` → cannot smoke-test built exe | `package.json:40-49` |
| B5  | ✅ | `state.json` written non-atomically — crash mid-write corrupts now-playing state | `src/broadcast/engine.js:59`, `src/broadcast/live.js:29` |
| B6  | ✅ | Live FFmpeg never `kill()`'d on shutdown — only `stdin.end()` — zombie on Windows | `src/broadcast/live.js:126-136` |
| B7  | ✅ | Unbounded `stderrBuf` accumulation in long-running broadcast → memory exhaustion | `src/broadcast/engine.js:226-238` |
| B8  | ✅ | Live `stdin.write()` ignores backpressure — unbounded buffer growth under load | `src/broadcast/live.js:117-124` |
| B9  | ✅ | Missing `busy_timeout` PRAGMA — moderate concurrent load returns SQLITE_BUSY 500s | `src/db/index.js:148-150` |
| B10 | ✅ | 2FA gate state transitions not atomic; `pendingChallenge` not cleared on network error → stale challenge replay attempts | `client/creator.html:2467-2519` |
| B11 | ✅ | Concat manifest `\r\n`-only filter — null bytes and other ffconcat directives can be injected via filename | `src/broadcast/concat.js:20-26` |

### 🟠 HIGH — strongly recommended before ship

| ID  | Status | Bug | Location |
|-----|--------|-----|----------|
| H1  | ✅ | Async route handlers can throw outside try/catch → process crash | `src/api/vault.js:386, 518` |
| H2  | ✅ | PayPal `custom_id` parsing has no tier validation; silent failure on malformed payload | `src/api/payment.js:603-613` |
| H3  | ✅ | Scanner `onFile()` fire-and-forget — chokidar can double-fire probe on rapid add/change | `src/scanner/watcher.js:29-30` |
| H4  | ✅ | `reconcileInactive()` not wrapped in transaction → race window where new files marked inactive | `src/scanner/sync.js:72-86` |
| H5  | ✅ | HLS cleanup deletes playlist + segments individually → 404 race for in-flight clients | `src/broadcast/engine.js:274-286` |
| H6  | ✅ | HLS player has no auto-recovery on fatal error → permanent stuck state for listener | `client/creator.html:1528-1531` |
| H7  | ✅ | Vault stat-button onclick handlers re-wired every panel open → listener leak | `client/creator.html:2744-2745` |
| H8  | ✅ | `check-migrations.js` doesn't assert `dashboard_2fa` table — 2FA path unverified at preflight | `scripts/check-migrations.js` |
| H9  | ✅ | `build-exe.js` order: `release:check` runs before `generate-native-bundle.js` — silent fail on clean clone | `scripts/build-exe.js:136` |
| H10 | ✅ | `media.filepath` not validated against `config.vault.path` at download time → path traversal if DB tampered | `src/api/library.js:330`, `src/api/downloads.js:82` |

### 🟡 MEDIUM — defer if time short

| ID  | Status | Bug | Location |
|-----|--------|-----|----------|
| M1  | ☐ | Cookie `secure` flag depends on `config.https` only; ignores `X-Forwarded-Proto` | `src/api/payment.js:442` |
| M2  | ☐ | Scanner `ignoreInitial: false` causes double-scan on startup | `src/scanner/watcher.js:20` |
| M3  | ☐ | Empty scheduled block silently falls back to global shuffle, no log | `src/broadcast/engine.js:132` |
| M4  | ☐ | Money input lacks client-side decimal-place validation | `client/creator.html:3235` |
| M5  | ☐ | DB `log()` swallows errors silently | `src/db/index.js:167` |
| M6  | ☐ | `nextSegmentNumber()` scans full HLS dir each batch — slow with many segments | `src/broadcast/engine.js:115` |

### ⚪ Findings explicitly dropped from the plan

These came up in audit but were determined not to be real bugs. **Do not waste time on them.**

- "Bearer token timing-safe compare" — SQL-equality lookup goes through a B-tree index; there is no per-byte timing leak that's practical to exploit on a self-hosted instance.
- "Recovery codes need argon2" — SHA-256 hashes of high-entropy random codes are sufficient.
- "DST scheduler bug" — speculative, no failing test case was demonstrated.
- "DASHBOARD_TOKEN should be 256 bits" — 128 bits is fine for a self-hosted dashboard secret.
- "Missing CSRF on dashboard endpoints" — cookie is `sameSite=strict`, which already mitigates CSRF. Confirm during Stage 1 H1 work; do not add CSRF middleware unless a concrete attack path is shown.

---

## Implementation Plan

Each stage is self-contained and can be committed atomically.

### Stage 1 — Security hot fixes (B1, B2, B3, B10, H2)

**Files touched:** `src/api/payment.js`, `src/api/auth.js`, `src/api/tokens.js`, `client/creator.html`

1. **B1** — Move PayPal signature verification block in `src/api/payment.js` from after the `hasWebhookEvent()` check (line ~594) to **before** it. `grep` for any other webhook handler that follows the same `dedup → verify` pattern; fix all instances.
2. **B2** — In `src/api/auth.js`, replace the `Map.get()` → check expiry → `Map.delete()` sequence with a single `Map.delete()` that returns the value, then validate. This makes consumption truly atomic in Node's single-threaded event loop. Apply to both the issue path and the verify path.
3. **B3** — Apply the existing `authLimiter` (or a new tighter limiter: 10 requests per 15-minute window keyed by IP) to `POST /api/tokens/redeem` in `src/api/tokens.js`.
4. **H2** — After splitting `custom_id` in the PayPal handler, validate `tier ∈ VALID_TIERS`; reject with 400 if invalid. Add a length sanity check (`custom_id.length < 256`) to reject malformed inputs early.
5. **B10** — In `client/creator.html`:
   - Wrap 2FA flow in a single state setter (e.g. `setDashGate('auth' | '2fa' | 'content')`) that explicitly sets `hidden` on all three gates atomically.
   - Add `.catch()` and `.finally()` blocks to both `/dashboard/login` and `/verify-2fa` fetches that clear `pendingChallenge = null` and reset the input on error.
   - In the BACK handler, also clear `el('dash-2fa-input').value` and `el('dash-auth-msg').textContent`.

**Verify:**
- Add unit tests in `test/auth.test.js` (create if missing) for atomic challenge consumption (two parallel verify calls — only one should succeed) and for the new rate limiter.
- Run `npm test`.

### Stage 2 — Broadcast subsystem (B5, B6, B7, B8, B11, H5)

**Files touched:** `src/broadcast/engine.js`, `src/broadcast/live.js`, `src/broadcast/concat.js`

1. **B5** — Add a `writeStateAtomic(state)` helper (in `engine.js` or a shared util): write JSON to `state.json.tmp`, then `fs.renameSync(tmp, final)`. Use everywhere `state.json` is written (both `engine.js:59` and `live.js:29`).
2. **B6** — In `stopLive()` in `live.js`, after `stdin.end()`, call `proc.kill('SIGTERM')`, then schedule `setTimeout(() => { if (!proc.killed) proc.kill('SIGKILL'); }, 2000)`. Mirror the escalation pattern already in `engine.js:288-305`.
3. **B7** — Cap `stderrBuf` at 64 KB. Easiest: when appending, if `stderrBuf.length > 65536`, slice the last 32 KB. Apply same logic in `live.js` if stderr is captured there.
4. **B8** — In `pushAudio()` in `live.js`, capture the return value of `stdin.write()`. When it returns `false`, signal the upstream producer to pause and resume on `stdin.once('drain', ...)`.
5. **B11** — In `concat.js`, replace the `/[\r\n]/` reject with a strict allowlist: reject any path containing characters outside `[A-Za-z0-9 ._\-/\\:]`. Add a comment explaining why (ffconcat injection prevention).
6. **H5** — For HLS cleanup at `engine.js:274-286`, swap individual-file deletion for atomic directory rotation: rename current `hls_output/stream` → `hls_output/stream.gc`, create a fresh empty `hls_output/stream`, then async-rm `stream.gc` in the background.

**Verify:**
- Manual: start broadcast, leave running 30 minutes, check process RSS (`tasklist /fi "imagename eq node.exe"`) for unbounded growth.
- Run `npm run check:scheduler`.
- Hard-kill the server mid-broadcast (`taskkill /F`) and confirm `state.json` still parses on next startup.

### Stage 3 — DB & scanner (B9, H3, H4, H8)

**Files touched:** `src/db/index.js`, `src/scanner/watcher.js`, `src/scanner/sync.js`, `scripts/check-migrations.js`

1. **B9** — Add `db.pragma('busy_timeout = 5000')` immediately after the WAL pragma in `src/db/index.js:148-150`.
2. **H3** — In `src/scanner/watcher.js:29-30`, either `await onFile()` inside the handler, OR introduce a `pending = new Map()` keyed by filepath that coalesces rapid add/change events into a single probe.
3. **H4** — Wrap the body of `reconcileInactive()` in `src/scanner/sync.js:72-86` in `db.transaction(() => { ... })()`.
4. **H8** — In `scripts/check-migrations.js`, add assertions after the existing checks that the `dashboard_2fa` table exists and has columns `secret`, `enabled`, `recovery_codes`, `created_at`.

**Verify:**
- `npm run check:migrations`
- `npm test`
- Manual: rapidly `touch` and delete files in `vault/`; confirm no duplicate rows in the `media` table.

### Stage 4 — API & packaging (B4, H1, H9, H10)

**Files touched:** `package.json`, `src/api/vault.js`, `src/api/library.js`, `src/api/downloads.js`, `scripts/build-exe.js`, possibly `scripts/check-package-assets.js`

1. **B4** — Add `"scripts/smoke-exe.js"` to the `pkg.scripts` array in `package.json`.
2. **H1** — Create a small `asyncHandler(fn)` wrapper (catches and forwards to `next`), or add explicit outer try/catch around the async bodies of the two `vault.js` routes at lines 386 and 518. Grep for `router\.(get|post|put|delete)\(.*async` across all of `src/api/` and apply the same pattern to any other unwrapped async routes.
3. **H9** — In `scripts/build-exe.js`, run `generate-native-bundle.js` **before** `release:check`. Alternatively (or additionally), promote the missing-`src/native-bundle.js` warning in `scripts/check-package-assets.js` to a hard failure.
4. **H10** — Add a `safeVaultPath(filepath)` helper that returns `null` if `path.resolve(filepath)` does not start with `path.resolve(config.vault.path)`. Use it in `src/api/library.js:330` and `src/api/downloads.js:82`; 403 if it returns null.

**Verify:**
- `npm run release:check`
- Build the exe on a clean checkout: in a worktree, run `git clean -xfd && npm install && npm run build:exe`, then `npm run smoke:exe`.

### Stage 5 — Frontend polish (H6, H7) — non-blocking

**Files touched:** `client/creator.html`

1. **H6** — On HLS fatal error, retry `loadSource()` with backoff `3s → 6s → 12s → 30s` (cap at 30s); reset backoff on successful manifest load.
2. **H7** — Wire the vault stat-button (`#vsb-tracks`, `#vsb-locked`, `#vsb-tokens`) click handlers exactly once during DOM initialization, not inside `openVaultPanel()`. Cache the element references.

**Verify:**
- Manual browser test against the running server: kill the broadcast process for 5 seconds; confirm the player auto-recovers.
- Open/close the vault panel 10 times; check `getEventListeners(el)` in DevTools to confirm a single listener.

### Stage 6 — Final Gate

Run, in order:

```bash
npm run release:check
npm run build:exe
npm run smoke:exe
```

If all three pass green, the executable is cleared for distribution.

---

## Patch Log

> As bugs are fixed, append entries here. Format: `YYYY-MM-DD | ID | brief note | commit sha`

- 2026-06-11 | B1,B2,B3,B10,H2 | Security hot fixes: PayPal verify-before-dedup/custom_id validation, atomic 2FA challenge consumption, token redeem rate limiting, dashboard 2FA gate reset flow, auth tests | uncommitted
- 2026-06-11 | B5,B6,B7,B8,B11,H5 | Broadcast fixes: atomic state writes, live FFmpeg termination, stderr caps, live backpressure signaling, concat path allowlist, HLS stream directory rotation | uncommitted
- 2026-06-11 | B9,H3,H4,H8 | DB/scanner fixes: busy_timeout, watcher probe coalescing, transactional inactive reconcile, 2FA migration assertions | uncommitted
- 2026-06-11 | B4,H1,H9,H10 | API/packaging fixes: pkg smoke-exe inclusion, async route wrapper, native bundle build order, vault-only download path guard and regression test | uncommitted
- 2026-06-11 | H6,H7 | Frontend polish: HLS fatal recovery backoff and one-time vault stat button binding | uncommitted
- 2026-06-11 | Verify | Passed npm test, check:migrations, check:scheduler, check:analytics, check:package, frontend script parse; preflight blocked by missing FFmpeg/ffprobe and port 3000 already in use | uncommitted

---

## Appendix: Notes for the implementer

- **Project conventions** are in `CLAUDE.md` (project) and the user's global `~/.claude/CLAUDE.md`. Highlights: plan first, verify with tests/logs not assumptions, no destructive SQL in migrations, prefer explicit over clever.
- **Pre-release gate** is `npm run release:check` (runs cleanliness, tests, preflight, migration/scheduler/analytics/package checks, and `npm audit --omit=dev`).
- **The frontend (`client/creator.html`) has ~1200 lines of uncommitted local changes** as of the audit (vault redesign + 2FA gate CSS fix). The line numbers above are approximate against the working tree — re-verify before patching.
- Do not add CSRF middleware to dashboard endpoints unless a concrete CSRF attack path can be demonstrated; the `sameSite=strict` cookie already covers the common case.
- Do not "improve" recovery code hashing to argon2 — the existing SHA-256 of high-entropy codes is appropriate. Spend the time on the listed bugs instead.
