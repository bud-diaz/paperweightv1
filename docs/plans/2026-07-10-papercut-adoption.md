# Papercut Feature Adoption Plan

**Goal:** Adopt the user-facing functions of Papercut (the `bud-diaz/cut` Expo/Express prototype) into Paperweight — per-track buy flow surfaced everywhere, listener "Your Collection" and purchase history, in-station Discover (trending + new releases), genre/tag browsing, and a creator earnings dashboard — while preserving Paperweight's identity: single-process Express + better-sqlite3, no ORM, no new runtime dependencies, single-file frontend, real payments through the existing Stripe/PayPal checkout, and graceful degradation when payments are unconfigured.

**Architecture:** No new services, packages, or clients. Every Papercut feature maps onto an existing Paperweight subsystem: purchases → `vault_unlocks` + existing unlock checkout (`src/api/vault.js`, `src/api/payment.js`); earnings → aggregation over `vault_unlocks`, `tips`, and `subscriptions`; discover trending → `listen_events` (same query shape as the dashboard-gated `/api/analytics/top`, restricted to public media); genre → media metadata captured by the vault scanner; library/collection UI → `client/creator.html`. Access decisions go through `src/auth/access.js` — no duplicated tier checks.

**Tech Stack:** Express routes under `src/api/`, better-sqlite3 with the existing migration pattern (next migration: `025`), vanilla JS in `client/creator.html`, Node test runner (`npm test`).

**Scope decisions (confirmed 2026-07-10):**
- Server + web UI only. Papercut's Expo mobile app is **not** ported; Paperweight's bearer-token support already leaves the door open for a future mobile client.
- Papercut's processor-less one-tap purchase is **not** replicated. "Buy" always goes through the existing vault unlock checkout with its payment idempotency.
- Discover is **in-station** (this station's own trending/new releases), not a change to the paperweighthq directory.

**Explicit Non-Goals:**
- No Postgres, Drizzle, Zod, OpenAPI/Orval codegen, or pnpm workspace structure from Papercut.
- No multi-creator user model ("top creators" has no meaning in a single-creator station and is dropped).
- No Replit object storage / presigned-URL uploads — the vault + existing dashboard upload path stays the source of truth for media.
- No client-writable play counter (Papercut's `POST /tracks/:id/play`). Trending derives from server-recorded `listen_events`; clients never increment counts directly.
- No changes to the broadcast engine, RSS feed, embed player, or station directory registration in this plan.

---

## Current State

### What Papercut has (feature inventory)

Papercut is a ~700-line prototype backend (`artifacts/api-server`) plus an Expo mobile app (`artifacts/mobile`). Its functions:

| # | Papercut function | Where |
|---|---|---|
| 1 | Tracks with per-unit price (cents), genre, cover art, play count | `lib/db/src/schema/tracks.ts`, `routes/tracks.ts` |
| 2 | Browse: title search + genre chip filter | `routes/tracks.ts` (`?search`, `?genre`), `app/(tabs)/browse.tsx` |
| 3 | Discover feed: trending (by plays), new releases, top creators | `routes/discover.ts`, `app/(tabs)/index.tsx` |
| 4 | One-tap purchase with duplicate guard, price-paid recorded | `routes/purchases.ts` |
| 5 | "Your Collection": purchased tracks as a library | `GET /users/:id/library`, `app/(tabs)/library.tsx` |
| 6 | Purchase history per user | `GET /users/:id/purchases` |
| 7 | Creator earnings: per-track units sold + revenue, totals | `GET /users/:id/earnings`, `app/(tabs)/profile.tsx` |
| 8 | Presigned-URL upload flow (cover + audio) | `routes/storage.ts`, `app/track/new.tsx` |
| 9 | Persistent global mini player with queue, next/prev, full-screen | `store/usePlayerStore.ts`, `components/GlobalPlayer.tsx` |

### What Paperweight already has (overlap map)

| Papercut function | Paperweight today | Gap |
|---|---|---|
| Per-track price + purchase | `vault_prices`, `vault_unlocks` (stores `amount_paid`, `created_at`), Stripe/PayPal checkout with idempotency | Exists but only surfaced inside the vault unlock-options UI — no Papercut-style price badge / buy button on tracks in the browsing views |
| Purchase dedupe | Unlock checks in `src/api/vault.js` | None |
| "Your Collection" | Access policy can answer "is this unlocked?" per item (`/api/vault/unlock-options/:id`) | No single listener-facing view/endpoint listing everything their account owns |
| Purchase history | `vault_unlocks` rows have all the data | No listener endpoint exposing it |
| Creator earnings | Tips summed only in private telemetry (`src/telemetry/reporter.js`); analytics has listeners/subscribers, not revenue | No earnings endpoint or dashboard panel at all |
| Discover trending | `GET /api/analytics/top` computes exactly this from `listen_events` — but dashboard-gated and not filtered to public media | No public equivalent |
| New releases | `media.indexed_at` exists | No public "newest" endpoint/section |
| Genre browse | `media.category` (scheduling-oriented) and `media.tags` (free text) | ffprobe genre metadata not captured as a first-class filterable field |
| Search | Library structure endpoint; no text search param | No `?search` on public library |
| Global player w/ queue | Player exists in `creator.html` | Queue semantics (play-from-context, next/prev) to verify/extend |
| Upload flow | Dashboard uploads into `vault/`, scanner ingests | Superior already — not adopted |

---

## Phases

### Phase 1 — Data groundwork: genre

**Task 1.1 — `genre` column on `media`.**
Add `genre TEXT` via the guarded programmatic ALTER pattern in `src/db/index.js` (SQLite `ALTER TABLE ... ADD COLUMN` cannot use `IF NOT EXISTS`), plus migration `025` registering the change as documentation. No destructive SQL. `npm run check:migrations` must stay green.

**Task 1.2 — Scanner captures genre.**
In `src/scanner/` (ffprobe adapter), read the `genre` tag from probed metadata and upsert it alongside title/artist/album. Existing rows backfill naturally on next rescan; absent genre stays NULL and the UI treats it as untagged.

**Task 1.3 — Dashboard edit.**
Allow editing genre wherever media metadata is already editable in the dashboard (same pattern as title/artist/tags).

### Phase 2 — Public discover + browse API

**Task 2.1 — `GET /api/library/discover`.**
New public route in `src/api/library.js` returning `{ trending, newReleases }`:
- `trending`: the `/api/analytics/top` query shape (join `listen_events`, window `7d`/`30d` via `?period`, order by `total_seconds`) **restricted to `visibility = 'public'` and `is_active = 1`**, limit 10.
- `newReleases`: newest public active media by `indexed_at`, limit 10.
Respect `src/auth/access.js` for anything beyond public visibility (i.e., don't leak vault/supporter items). Cache-friendly; no writes.

**Task 2.2 — Browse filters on the public library.**
Add `?search=` (title/artist LIKE) and `?genre=` params to `GET /api/library` (and expose the distinct genre list, e.g. in `/api/library/structure` or a tiny `/api/library/genres`), so the frontend can render Papercut's Browse screen: search box + genre chips.

**Task 2.3 — Price + owned state in library payloads.**
Where library items are returned to listeners, include (a) the track's price/unlockability summary from `vault_prices`, and (b) an `owned`/`unlocked` boolean computed through the existing access policy for the current `req.tier`/listener. This is what lets the frontend show Papercut-style price badges and "in your collection" checkmarks without N+1 requests.

### Phase 3 — Listener collection + purchase history

**Task 3.1 — `GET /api/listener/collection`.**
For the authenticated listener (cookie or bearer): every media item their account can access beyond public — track unlocks, project unlocks, all-access, and assigned-token tier grants — resolved through `src/auth/access.js`. This is Papercut's "Your Collection".

**Task 3.2 — `GET /api/listener/purchases`.**
Their `vault_unlocks` rows (active and expired) with `unlock_type`, resolved target title, `amount_paid`, `payment_type`, `created_at`, `expires_at`. Include in the existing `GET /api/listener/export` data-export payload.

### Phase 4 — Creator earnings dashboard

**Task 4.1 — `GET /api/dashboard/earnings` (requireDashboard).**
Papercut's earnings shape, extended to Paperweight's revenue sources:
- Per-track/per-project: units sold + gross cents from `vault_unlocks` grouped by `unlock_type`,`target_id`, joined to `media`/`vault_projects` for titles.
- Tips total (and recent tips) from `tips`.
- Active subscription count from `subscriptions` (revenue only if amount data exists — otherwise count only; don't invent numbers).
- Grand totals: `totalUnitsSold`, `totalRevenueCents` per source and combined.

**Task 4.2 — Earnings panel in the dashboard UI.**
New section in `client/creator.html`'s dashboard: totals row + per-track table (title, units, revenue), mirroring Papercut's profile earnings card. Renders "no payment provider configured" gracefully when Stripe/PayPal are absent.

### Phase 5 — Listener frontend (client/creator.html)

All within the single-file frontend — no new local JS files.

**Task 5.1 — Discover section.** "Trending" and "New releases" rows on the player/home view, fed by `/api/library/discover`. Reuse existing artwork endpoints for cover art. Keep the existing highlight feature as the hand-curated slot above it.

**Task 5.2 — Browse upgrades.** Search input + genre chips over the library view, using Task 2.2 params.

**Task 5.3 — Buy flow surfacing.** Price badge on every priced track in library/discover lists; "Buy"/"Unlock" button opens the existing unlock checkout (`/api/vault/unlock` flow); owned items show a collection checkmark instead. Zero new payment paths.

**Task 5.4 — "Your Collection" view.** Listener-facing tab/section listing `/api/listener/collection`, with purchase history from `/api/listener/purchases` (Papercut's Library tab + purchases, merged).

**Task 5.5 — Player queue polish.** Ensure playing a track from a browse/discover/collection list sets that list as the queue with working next/prev (Papercut's `usePlayerStore` semantics), and that the mini player persists across views. Extend the existing player only — no rewrite.

### Phase 6 — Tests and release gate

**Task 6.1 — HTTP tests** for: discover (public-only leakage check — vault items must never appear), library search/genre filters, collection/purchases auth boundaries (listener A cannot read listener B; anonymous gets 401), earnings requires dashboard auth.

**Task 6.2 — Checks.** `npm run check:migrations` for the genre change; full `npm run release:check` green before merge.

---

## Sequencing and risk

- Phases 1–2 are independent of 3–4; 5 depends on all of 2–4. Suggested order: 1 → 2 → 3 → 4 → 5 → 6, but 3 and 4 can be built in parallel with 2.
- Riskiest surface: Task 2.3 (owned-state in list payloads) — must go through `access.js` and be computed per-request without noticeable latency on large vaults; add an index only if measured.
- Leak risk: discover/trending must filter visibility *in SQL*, not post-hoc, and tests must cover it (Task 6.1).
- Everything degrades: no payments configured → prices hidden or shown as locked without checkout; no genres tagged → chips collapse to search-only.
