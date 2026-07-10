# Papercut Feature Adoption Plan

**Goal:** Adopt the user-facing functions of Papercut (the `bud-diaz/cut` Expo/Express prototype) into Paperweight — a "Welcome to Paperweight" onboarding page where listeners start an account with only a display name (optional email for the creator's marketing list), per-track buy flow surfaced everywhere, listener "Your Collection" and purchase history, in-station Discover (trending + new releases), genre/tag browsing, and a creator earnings dashboard — while preserving Paperweight's identity: single-process Express + better-sqlite3, no ORM, no new runtime dependencies, single-file frontend, real payments through the existing Stripe/PayPal checkout, and graceful degradation when payments are unconfigured.

**Architecture:** No new services, packages, or clients. Every Papercut feature maps onto an existing Paperweight subsystem: onboarding → the existing `pw_token` issuance path (`issueToken()` in `src/api/listener.js`) with a new lightweight `listener_profiles` table; purchases → `vault_unlocks` + existing unlock checkout (`src/api/vault.js`, `src/api/payment.js`); earnings → aggregation over `vault_unlocks`, `tips`, and `subscriptions`; discover trending → `listen_events` (same query shape as the dashboard-gated `/api/analytics/top`, restricted to public media); genre → media metadata captured by the vault scanner; library/collection/welcome UI → `client/creator.html`. Access decisions go through `src/auth/access.js` — no duplicated tier checks.

**Tech Stack:** Express routes under `src/api/`, better-sqlite3 with the existing migration pattern (next migrations: `025`, `026`), vanilla JS in `client/creator.html`, Node test runner (`npm test`).

**Scope decisions (confirmed 2026-07-10):**
- Server + web UI only. Papercut's Expo mobile app is **not** ported; Paperweight's bearer-token support already leaves the door open for a future mobile client.
- Papercut's processor-less one-tap purchase is **not** replicated. "Buy" always goes through the existing vault unlock checkout with its payment idempotency.
- Discover is **in-station** (this station's own trending/new releases), not a change to the paperweighthq directory.
- Onboarding follows Papercut's opening page: display name is the only required field, with a collapsible optional email field (explicit marketing consent) that feeds the creator's email list.

**Explicit Non-Goals:**
- No Postgres, Drizzle, Zod, OpenAPI/Orval codegen, or pnpm workspace structure from Papercut.
- No multi-creator user model ("top creators" has no meaning in a single-creator station and is dropped; Papercut's "I make music too" creator toggle is dropped — the creator is the station owner via the dashboard).
- No Replit object storage / presigned-URL uploads — the vault + existing dashboard upload path stays the source of truth for media.
- No client-writable play counter (Papercut's `POST /tracks/:id/play`). Trending derives from server-recorded `listen_events`; clients never increment counts directly.
- No rebuild of `listener_accounts` (its `email`/`password_hash` stay `NOT NULL`; auto-applied migrations must not rebuild tables per repo policy). Display-name-only identities live in a new table instead.
- No changes to the broadcast engine, RSS feed, embed player, or station directory registration in this plan.

---

## Current State

### What Papercut has (feature inventory)

Papercut is a ~700-line prototype backend (`artifacts/api-server`) plus an Expo mobile app (`artifacts/mobile`). Its functions:

| # | Papercut function | Where |
|---|---|---|
| 1 | "Welcome to Papercut" opening page: display-name-only account creation gates entry | `app/index.tsx`, `POST /users`, `store/useAuthStore.ts` |
| 2 | Tracks with per-unit price (cents), genre, cover art, play count | `lib/db/src/schema/tracks.ts`, `routes/tracks.ts` |
| 3 | Browse: title search + genre chip filter | `routes/tracks.ts` (`?search`, `?genre`), `app/(tabs)/browse.tsx` |
| 4 | Discover feed: trending (by plays), new releases, top creators | `routes/discover.ts`, `app/(tabs)/index.tsx` |
| 5 | One-tap purchase with duplicate guard, price-paid recorded | `routes/purchases.ts` |
| 6 | "Your Collection": purchased tracks as a library | `GET /users/:id/library`, `app/(tabs)/library.tsx` |
| 7 | Purchase history per user | `GET /users/:id/purchases` |
| 8 | Creator earnings: per-track units sold + revenue, totals | `GET /users/:id/earnings`, `app/(tabs)/profile.tsx` |
| 9 | Presigned-URL upload flow (cover + audio) | `routes/storage.ts`, `app/track/new.tsx` |
| 10 | Persistent global mini player with queue, next/prev, full-screen | `store/usePlayerStore.ts`, `components/GlobalPlayer.tsx` |

### What Paperweight already has (overlap map)

| Papercut function | Paperweight today | Gap |
|---|---|---|
| Display-name-only entry | `POST /api/listener/register` requires email + password (both `NOT NULL` in `listener_accounts`); anonymous listening is otherwise unauthenticated | No frictionless named identity; no welcome page |
| Optional email → creator marketing list | `download_leads` (+ opt-in, migration 020) captures emails only on the download page; subscriber/listener CSV exports exist | No opt-in email capture at listener entry; no unified consented "audience" export |
| Creator profile/database | `creator_profile` table (migration 013) already exists | Nothing to create — the missing piece is the *audience email list*, covered below |
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

### Phase 3 — Welcome onboarding + audience email list

Papercut's opening page, in Paperweight's skin: listeners start an account with just a display name; email is optional, collapsible, and consent-gated — and consented emails become the creator's marketing list.

**Task 3.1 — Migration `026`: `listener_profiles` table.**
`listener_accounts` cannot hold display-name-only identities (email/password are `NOT NULL`, and auto-applied migrations must not rebuild tables), so lightweight identities get their own table:

```sql
CREATE TABLE IF NOT EXISTS listener_profiles (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  display_name     TEXT    NOT NULL,
  email            TEXT,
  marketing_opt_in INTEGER NOT NULL DEFAULT 0,
  account_id       INTEGER REFERENCES listener_accounts(id),
  token_id         INTEGER REFERENCES tokens(id),
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  last_seen_at     TEXT
);
```

`token_id` links the profile to the `pw_token` issued at entry so `attachTier` / `/api/listener/me` can resolve the display name; `account_id` is filled if/when the listener upgrades to a full email+password account. `email` is stored **only** when provided, and `marketing_opt_in` only when the consent box is explicitly ticked.

**Task 3.2 — `POST /api/listener/start`.**
Body: `{ displayName, email?, marketingOptIn? }`. Display name required (trimmed, length-capped); email validated when present. Creates the profile row, issues a free-tier token through the existing `issueToken()` path, sets the `pw_token` cookie (and returns `{ token, tier, displayName }` for bearer clients) — exactly mirroring `register`'s response shape. Rate-limited with the existing `authLimiter`. Extend `GET /api/listener/me` to return the display name, and extend the existing data-export and self-service-deletion flows to cover profile rows (consent data must be deletable).

**Task 3.3 — Supporter upgrade path.**
Becoming a supporter (subscription or vault unlock) requires a full `listener_accounts` row (`vault_unlocks.listener_id` FK). When a display-name-only listener hits a checkout, prompt them to complete their account (email + password), prefilled with the profile email if they gave one; on completion, create the `listener_accounts` row, set `listener_profiles.account_id`, and keep the same `pw_token`. Existing register/login flows are untouched for listeners who already have accounts.

**Task 3.4 — Welcome page in `client/creator.html`.**
First-visit overlay (no `pw_token` cookie present), styled with Paperweight's existing design language — not Papercut's:
- "Welcome to {stationName}" heading + station tagline (from `creator_profile` / settings).
- Display name input; **Enter** button enabled once non-empty (Papercut's exact gesture).
- Collapsible "Add your email (optional)" section with an explicit consent checkbox, worded plainly (e.g. "Send me updates and releases from this station") — collapsed by default; supports the "for when/if they become a supporter" prefill in Task 3.3.
- "Already have an account? Log in" link into the existing login flow.
- A "Just listen" skip link, so the public radio stream stays frictionless (recommended for Paperweight's identity; trivially removable if the creator wants a hard gate like Papercut's).
- Never shown on `/embed`, `/feed.xml`, the landing pages, or the dashboard.

**Task 3.5 — Audience email list for the creator.**
The creator "database" already exists (`creator_profile`, migration 013); what's new is the **audience list**. Add a dashboard endpoint + panel ("Audience") and CSV export that merges consented emails, deduplicated by email address, from:
- `listener_profiles` where `marketing_opt_in = 1`,
- `download_leads` opt-ins (existing),
- optionally active subscribers (`listener_accounts` joined to `subscriptions`) — included only if the creator's export choice says so, since subscribing is not marketing consent.
Follows the existing CSV export patterns (subscribers/listeners/download-leads exports in the dashboard). Only opted-in emails ever appear in the marketing export.

### Phase 4 — Listener collection + purchase history

**Task 4.1 — `GET /api/listener/collection`.**
For the authenticated listener (cookie or bearer): every media item their account can access beyond public — track unlocks, project unlocks, all-access, and assigned-token tier grants — resolved through `src/auth/access.js`. This is Papercut's "Your Collection".

**Task 4.2 — `GET /api/listener/purchases`.**
Their `vault_unlocks` rows (active and expired) with `unlock_type`, resolved target title, `amount_paid`, `payment_type`, `created_at`, `expires_at`. Include in the existing `GET /api/listener/export` data-export payload.

### Phase 5 — Creator earnings dashboard

**Task 5.1 — `GET /api/dashboard/earnings` (requireDashboard).**
Papercut's earnings shape, extended to Paperweight's revenue sources:
- Per-track/per-project: units sold + gross cents from `vault_unlocks` grouped by `unlock_type`,`target_id`, joined to `media`/`vault_projects` for titles.
- Tips total (and recent tips) from `tips`.
- Active subscription count from `subscriptions` (revenue only if amount data exists — otherwise count only; don't invent numbers).
- Grand totals: `totalUnitsSold`, `totalRevenueCents` per source and combined.

**Task 5.2 — Earnings panel in the dashboard UI.**
New section in `client/creator.html`'s dashboard: totals row + per-track table (title, units, revenue), mirroring Papercut's profile earnings card. Renders "no payment provider configured" gracefully when Stripe/PayPal are absent.

### Phase 6 — Listener frontend (client/creator.html)

All within the single-file frontend — no new local JS files.

**Task 6.1 — Discover section.** "Trending" and "New releases" rows on the player/home view, fed by `/api/library/discover`. Reuse existing artwork endpoints for cover art. Keep the existing highlight feature as the hand-curated slot above it.

**Task 6.2 — Browse upgrades.** Search input + genre chips over the library view, using Task 2.2 params.

**Task 6.3 — Buy flow surfacing.** Price badge on every priced track in library/discover lists; "Buy"/"Unlock" button opens the existing unlock checkout (`/api/vault/unlock` flow); owned items show a collection checkmark instead. Zero new payment paths. Display-name-only listeners are routed through the Task 3.3 account-completion step first.

**Task 6.4 — "Your Collection" view.** Listener-facing tab/section listing `/api/listener/collection`, with purchase history from `/api/listener/purchases` (Papercut's Library tab + purchases, merged). Greets the listener by display name.

**Task 6.5 — Player queue polish.** Ensure playing a track from a browse/discover/collection list sets that list as the queue with working next/prev (Papercut's `usePlayerStore` semantics), and that the mini player persists across views. Extend the existing player only — no rewrite.

### Phase 7 — Tests and release gate

**Task 7.1 — HTTP tests** for: discover (public-only leakage check — vault items must never appear), library search/genre filters, onboarding (`/api/listener/start` validation, token issuance, email optionality, consent flag), audience export (emails without `marketing_opt_in = 1` never appear), collection/purchases auth boundaries (listener A cannot read listener B; anonymous gets 401), earnings requires dashboard auth.

**Task 7.2 — Checks.** `npm run check:migrations` for migrations 025/026; full `npm run release:check` green before merge.

---

## Addendum (2026-07-10, second pass)

Two requirements added after the initial plan; both are station-side (this repo). The system.pape/directory side will be wired in a separate session.

**A. Repeat-listener identity across visits (and later, across stations).**
The `pw_token` issued at `POST /api/listener/start` is the durable identity: it persists in the httpOnly cookie (and as a bearer token for other clients), so a returning listener is recognized without re-entering anything. `listener_profiles.last_seen_at` is refreshed on authenticated `GET /api/listener/me` calls, giving the station a repeat-listener signal. The station-side contract for the future system.pape wiring is intentionally minimal: profiles are keyed by token, `GET /api/listener/me` returns `{ displayName, tier, ... }` for any valid token, and the existing telemetry reporter can later include aggregate repeat-listener counts. Cross-station account sync (the "saved stations" cloud phase in `src/api/listener.js`) stays untouched here.

**B. Permission-gated local saves for offline browser playback.**
New `media.offline_allowed` flag (guarded ALTER, default 0). When the creator enables it on a track, listeners who can *access* the track (per `access.js`) may fetch the full file through the existing signed-URL download path and store it in browser storage (IndexedDB/Cache API on the frontend) for on-demand playback. Policy change is one carve-out in `canDownloadMedia`: `offline_allowed = 1` → download permitted at access level rather than subscriber level. Saving requires a token (welcome-page entry or account) because the signed URL context is token-bound — fully anonymous visitors can stream but not save, which also nudges onboarding. The dashboard media editor gets the toggle; the client stores files keyed by media id + a version stamp.

## Sequencing and risk

- Phase 1 → 2 in order; Phase 3 (onboarding) is independent of 1–2 and can be built in parallel; Phases 4–5 depend only on existing tables; Phase 6 depends on 2–5; Phase 7 last.
- Riskiest surfaces:
  - Task 2.3 (owned-state in list payloads) — must go through `access.js` and be computed per-request without noticeable latency on large vaults; add an index only if measured.
  - Task 3.3 (guest → account upgrade) — must keep the same `pw_token` across the upgrade and never orphan `vault_unlocks`; checkout paths must refuse to record unlocks against a profile with no `listener_accounts` row.
- Leak risk: discover/trending must filter visibility *in SQL*, not post-hoc, and tests must cover it (Task 7.1).
- Consent risk: the marketing export must be strictly opt-in-only; storing an email at onboarding without the consent box ticked must set `marketing_opt_in = 0`, and profile deletion/data export must include it.
- Everything degrades: no payments configured → prices hidden or shown as locked without checkout; no genres tagged → chips collapse to search-only; SMTP unconfigured → email list still collects, only sending is unavailable (matching `isEmailConfigured()` behavior).
