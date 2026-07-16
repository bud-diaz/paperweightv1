# Paperweight — Product Overview

Paperweight is self-hosted, creator-first streaming and distribution software. It turns a single machine — a Windows/macOS/Linux desktop or a Raspberry Pi — into a creator-owned internet radio station and content storefront. One process does everything: it scans a local media vault, broadcasts a continuous HLS stream, serves a public listener player, and gives the creator a full dashboard for scheduling, uploads, access control, monetization, and analytics.

It is built for **one creator (or a small trusted team) running one station**. It is not a multi-tenant SaaS platform. There are no platform fees, no algorithm, and no third party between the creator and their audience: media files stay on the creator's disk, listener data stays in the creator's SQLite database, and payments go directly to the creator's own Stripe/PayPal accounts.

This document is an exhaustive tour of the product from both sides of the glass: what **listeners** experience, and what **creators** can do.

---

## Table of Contents

1. [Core Concepts](#core-concepts)
2. [Listener-Side Features](#listener-side-features)
3. [Creator-Side Features](#creator-side-features)
4. [Notifications & Outbound Integrations](#notifications--outbound-integrations)
5. [Public Surfaces Beyond the Player](#public-surfaces-beyond-the-player)
6. [Deployment, Platforms & Feature Gating](#deployment-platforms--feature-gating)
7. [Privacy & Security Posture](#privacy--security-posture)

---

## Core Concepts

### The vault

The **vault** is a folder on the creator's machine (`vault/`) that holds all station media. A file watcher (chokidar) monitors it continuously; anything dropped in is probed with `ffprobe` and indexed into SQLite automatically — no "import" step. Files are categorized as `music`, `beats`, `podcasts`, `videos`, `drafts`, or `live_sessions`, either by top-level folder name, by file metadata, or a hybrid of both (the default: folder name wins when it matches a known category, metadata otherwise). Audio and video are both first-class.

### Visibility

Every media item has one of three visibility levels:

| Visibility | Who can play it |
|---|---|
| `public` | Everyone, no account needed |
| `supporters_only` | Subscriber tier and above, or holders of a scoped token |
| `vault` | Paid unlock, scoped token, project unlock, track unlock, or all-access |

The 24/7 broadcast only ever plays **public** local files — gated content can never leak onto the radio stream, the RSS feed, or the public discover feed. Gated items are still *visible* in browse views (title, artwork, price) so listeners can discover and unlock them, but every play/download route re-checks access server-side.

### Access tiers

Listeners hold a tier, resolved on every request from their token:

| Tier | Access |
|---|---|
| `free` | Public tracks; limited on-demand plays |
| `subscriber` | Public + supporters-only tracks; unlimited on-demand; downloads |
| `pro` | Everything in subscriber (a higher-priced supporter level) |
| `all_access` | Everything, including the entire vault when the creator enables all-access vault inclusion |

A tier is acquired three ways: redeeming a creator-issued token, subscribing through Stripe or PayPal, or having a token assigned directly to a listener account by the creator.

### Tokens

Access tokens are the universal credential. They are stored hashed, delivered as an `httpOnly` cookie (`pw_token`) for web or as a Bearer token for mobile clients, and come in several flavors:

- **Tier tokens** — grant `subscriber` / `pro` / `all_access` outright (e.g., for friends, promoters, superfans).
- **Scoped tokens** — grant access to exactly one track or one project, regardless of tier.
- **Account-linked tokens** — minted automatically at listener registration/login (a fresh token per login, so each device carries its own credential).
- **Assigned tokens** — a creator token bound to a specific listener account by email.

---

## Listener-Side Features

### 1. The live station (radio)

- **24/7 HLS broadcast.** The station plays continuously from the creator's public library — FFmpeg reads a concat manifest and serves HLS segments any browser can play (via the bundled hls.js, or natively in Safari). Video files broadcast as video; the player switches automatically.
- **Now-playing display.** The player shows the current track (title/artist/artwork), pulled from live broadcast state, and updates as the station moves through its playlist.
- **Up-next visibility.** The next few queued tracks (from the current batch plus anything the creator hand-queued) are exposed to the player.
- **Live listener count.** The player pings every 30 seconds; the station shows how many people are listening right now (anonymous, IP-hashed sessions that expire after 60 s of silence).
- **Live broadcasts interrupt the radio.** When the creator goes live (mic or external audio encoder), the player automatically switches to the live HLS source and shows a live indicator; when the broadcast ends it falls back to the station stream.
- **Paid-tier live video.** A separate, independent live feed: the creator streams video (RTMP from OBS or any encoder) to its own HLS output, and only listeners at or above a creator-configurable minimum tier (default `subscriber`) can load it — access is enforced server-side on every segment request, not just hidden in the UI. Listeners below the tier see a subscribe/tip call to action instead. This is unrelated to the free mic/RTMP audio broadcast above; the two run on separate ports, processes, and HLS outputs, and either can be live independent of the other.

### 2. Library browsing & discovery

- **Structured library.** `GET /api/library/structure` returns the catalog grouped into **projects** (creator-defined collections — albums, beat packs, seasons) and **standalone tracks**, each with title, artist, album, genre, producer, credits, BPM, tags, duration, artwork, and visibility.
- **Curated drawer.** The player surfaces three curated slots computed server-side: the most recently active project, the most-played track (from real listen data), and a creator-chosen **highlight** (any track or project the creator pins).
- **Search & filters.** Full-text search across title/artist/filename, category filters, and **genre chips** (distinct genres with counts, computed across the visible catalog).
- **Discover feed.** A public trending view: top tracks by actual seconds listened over a configurable window (1–90 days) plus the newest releases — restricted to public items only.
- **Lock states & pricing inline.** Every item is annotated per-listener with `unlocked` status and, for vault items, its price card (suggested price, minimum, free-allowed flag, one-time vs. recurring) so the UI can show buy/unlock affordances without extra round-trips.

### 3. On-demand playback

- **Play any track on demand**, not just what the radio is playing — subject to access checks and a fair-use quota.
- **Free-tier play quota.** Anonymous visitors get **3 on-demand plays/hour**, identified free listeners get **5/hour**; subscribers and unlocked-vault plays are unlimited. Replays of the same track within 5 minutes don't double-count.
- **"Next up" bonus slot.** A listener who has spent their hourly quota can still arm **one** track to play automatically after the current broadcast track ends — a deliberate escape valve that converts a hard limit into an engagement moment. The player checks slot availability before offering it.
- **60-second previews.** Every public and supporters-only track has a free preview: the server cuts a 60 s AAC (audio) or H.264 MP4 (video) excerpt on first request and caches it. Vault items intentionally have **no** preview until unlocked.
- **Artwork everywhere.** Artwork is served from (in priority order) a creator-uploaded image, the file's embedded cover art (extracted by FFmpeg and cached), or a creator-supplied external URL.

### 4. Listener identity — three levels of commitment

Paperweight deliberately keeps the entry gradient shallow:

1. **Just listen.** No account, no name, nothing. The public stream and public library work anonymously.
2. **Welcome profile.** On first visit an overlay asks only for a **display name** (email optional, and used for the creator's marketing list *only* with an explicit opt-in checkbox). This mints a lightweight free-tier identity so the listener is recognized on return visits, can save offline tracks, and counts toward audience insights. It can be deleted by the listener at any time.
3. **Full account.** Email + password (bcrypt, 8-char minimum). A welcome profile automatically links into the account created on the same device, carrying over the display name and consent. Full accounts are required for purchases.

Account self-service includes:

- **Login/logout** with per-login token minting (multiple concurrent devices, each with its own revocable credential).
- **Email verification (paid tiers only).** The first time an account goes paid (subscription, tip-with-email, etc.) while its email is unverified, a verification email goes out and a 24-hour grace period starts. Inside the window everything works normally; once the window lapses, an unverified account loses supporters-only and vault subscriber-tier access (already-purchased vault unlocks are unaffected) until the listener clicks the link or requests a resend. Free-tier listeners are never asked to verify.
- **Password reset** two ways: self-service email (when the creator configured SMTP; responses never reveal whether an account exists) or a **creator-generated reset link** handed over any channel — the no-SMTP fallback. Reset links live 60 minutes and consume all outstanding resets for the account when used.
- **Set/change password** — including subscribers whose accounts were auto-created during Stripe checkout (the UI detects they have no usable password and prompts them to set one).
- **Data export.** One click downloads a JSON file of everything stored about the listener: account, profile, subscriptions, vault unlocks, token assignments, saved stations.
- **Self-service deletion.** Deleting an account cancels active subscriptions at the provider (best-effort, with warnings if it fails), revokes all tokens, deletes PII-bearing rows, and scrubs the account to an anonymized tombstone — purchase records survive for the creator's accounting but are detached from any usable identity.

### 5. Subscriptions & payments

- **Subscribe from the player.** When a free listener hits a supporters-only track, the player offers Stripe Checkout for the subscriber tier. No pre-registration needed: checkout can create a pending account that is activated and cookie-authenticated on return (a nonce-bound flow that prevents session fixation).
- **Stripe and PayPal** are both supported for subscriptions (`pro` and `all_access` plans additionally exist for the native-app/cloud flow). Webhooks are signature-verified and idempotent — a replayed or duplicated event can never double-apply.
- **Self-service cancellation** from the player. Stripe cancels at period end (access continues until paid time lapses); PayPal cancels future billing and downgrades when the provider confirms.
- **Stripe billing portal.** One click opens Stripe's hosted portal to manage cards, view invoices, and cancel.
- **Subscription status** is always visible in the account panel: tier, provider, renewal date.
- **Tips.** Anyone — no account required — can tip the station through Stripe Checkout, choosing from three creator-configured amounts or a custom amount (when the creator allows it, $1–$1,000 bounds). An optional name and email on the tip form let the tipper stay anonymous or be recognized; giving an email grants **7 days of subscriber-tier access** (an existing matching account is reused, or a fresh one is created and either logged in automatically or emailed an auto-login link, depending on whether SMTP is configured), the same grant/expiry mechanism used for real subscriptions, just sourced from a one-time tip instead of a recurring provider subscription.

### 6. The vault: pay-what-you-want unlocks

The vault is Paperweight's Bandcamp-style storefront layer:

- **Three unlock scopes:** a single **track**, a whole **project** (album/pack), or **all-access** (everything in the vault, forever or as a subscription).
- **Pay-what-you-want pricing.** Each item carries a suggested price and a minimum; the creator can also allow **free** (name-your-price-from-zero) unlocks, which complete instantly without checkout.
- **One-time or recurring.** Unlocks can be permanent purchases or monthly/annual recurring access (recurring unlocks lapse automatically if the underlying Stripe subscription fails or is cancelled).
- **Locked-item UX.** Hitting a locked item returns the full unlock option set (track price, parent project price, all-access price) so the player can render a proper paywall with every path to access.
- **Your Collection.** A dedicated view of everything the listener owns — resolved through the same ownership engine the library uses (track unlocks, project unlocks, all-access, scoped tokens).
- **Purchase history.** Every unlock with amount paid, date, type, and active/expired state.

### 7. Downloads & offline saves

- **Subscriber downloads.** Subscriber-tier listeners (and up) can download any track they can access, via short-lived HMAC-signed URLs (1 h expiry) that re-verify entitlement at redemption time — a leaked link dies with the entitlement.
- **Creator-flagged offline saves.** The creator can mark any track `offline_allowed`, letting **any listener who can access it** (including free-tier) save the full file for offline playback in the browser — stored in IndexedDB, played through an object URL so it works with no connection. Saving requires at least a welcome-profile identity (the signed URL is token-bound).
- **Single-use legacy download tokens** (48 h TTL) also exist for older clients, consumed on redemption and re-authorized at download time.

### 8. Creator posts (updates feed)

A Patreon-style text feed inside the player:

- Posts are **public** or **supporters-only**; the listener feed filters by tier and never shows scheduled posts before their publish time.
- Paginated, newest-first, with title + body.

### 9. Creator bio page

A public "about the creator" panel (when the creator enables it): bio text, profile picture, social links (Instagram, Twitter, YouTube, SoundCloud, Spotify, Bandcamp), "creator since" date, and their latest release.

### 10. Share links (recipient side)

A share link (`/share/<token>`) opens a track or a whole project with **no account and no tier check** — the token is the credential. Recipients can stream everything in the share through signed URLs. Links can carry an expiry; expired or deleted links stop working immediately.

### 11. Podcast/RSS feed

When the creator enables it, `/feed.xml` is a standard RSS 2.0 + iTunes-tags feed any podcast app can subscribe to — public items only, with Range-capable enclosure streaming. Turning the feed off also kills previously cached enclosure URLs.

### 12. Embeddable mini player

`/embed` is a tiny frameable player (relaxed CSP for iframing) that plays the public live stream — live-broadcast aware, video-capable, with a link back to the station. Made for dropping into any external website.

### 13. Station directory ("Paperweight Listen")

A standalone public page (`/landing/listen`, served as `/listen` on the hosted landing) where listeners can search for public Paperweight stations by name/slug, see live listener counts and now-playing, and play any station inline. Stations appear only when their creator has explicitly opted in (see creator side). In the cloud/native-app phase, logged-in listeners can also **save stations** to a personal list.

---

## Creator-Side Features

Everything below lives in the dashboard, a tab of the same single-page app (`/#dashboard`), gated by dashboard authentication.

### 1. Dashboard access & security

- **Token login.** The creator logs in with a dashboard token (generated at setup, stored in `.env`), exchanged for a 24 h `httpOnly` session cookie. Listener cookies can never grant dashboard access.
- **Optional TOTP 2FA.** Setup generates a QR-compatible otpauth secret; confirmation requires a live code and returns **one-time recovery codes** (hashed at rest, single-use, constant-time compared). TOTP counters are tracked to block replay of a just-used code. When 2FA is on, the header-token fallback is disabled — sessions are the only way in.
- **First-launch acceptance.** A content-responsibility acceptance is recorded (with app version) before the dashboard unlocks.

### 2. Media & vault management

- **Automatic ingestion.** Drop files in `vault/` — the watcher probes, categorizes, and indexes them live. Startup reconciliation marks vanished files inactive and repairs stale video MIME types.
- **Folder-import collections (desktop).** Pick any external folder and Paperweight copies it into the vault, indexes every supported file, and creates (or reuses) a project named after the folder with all of it linked in — turning a folder of tracks into a collection in one action instead of uploading and organizing file by file. The same logic also runs once, automatically, right after first-run setup to adopt any folders already present in a vault the creator pointed setup at.
- **Browser uploads.** Drag-and-drop upload (up to 2 GB/file; audio and video MIME types only). Uploads are ffprobe-validated *before* entering the vault, land in the right category folder with sanitized collision-safe names, and the chosen visibility is stamped so the scanner can't override it.
- **Metadata editing.** Title, artist, album, genre, producer, credits, tags, artwork URL — all editable per item.
- **Artwork uploads.** Upload a cover image per track (10 MB max, content-sniffed to be a real image); it overrides embedded art and external URLs.
- **Visibility control** per item: public / supporters-only / vault.
- **Offline-save flag** per item (`offline_allowed`).
- **Scheduled releases.** Set `release_at` on any non-public item and a 30-second poller flips it to public at the right moment — and fires the "new release" webhook announcement exactly once. Setting visibility to public manually cancels the pending schedule; scheduling requires a future timestamp.
- **External catalog items (desktop).** Search **YouTube** and **SoundCloud** (with the creator's own API keys) from the dashboard and add external tracks to the catalog — they appear in the library with an external badge and link out; they never enter the broadcast, feed, or download paths.
- **Vault stats.** Total files, total hours, per-category counts, last scan time.

### 3. Broadcast programming (the radio)

- **Two modes:** `shuffle` (whole-library auto-DJ) and `scheduled` (dayparting).
- **Weighted shuffle.** The auto-DJ prefers tracks that haven't been played recently (least-recently-played first, random tiebreak), so the rotation stays fresh instead of purely random.
- **Schedule blocks (dayparting).** Weekly programming blocks: day-of-week (or every day), start/end time (overnight blocks that cross midnight are handled), category filter, tag filters, priority for overlaps, and a per-block mode — shuffle within the filter, **sequential** (a hand-ordered playlist attached to the block), or a smart playlist.
- **Smart playlists (desktop).** Saved rule sets (category + tags + shuffle/sequential) that can be attached to schedule blocks; each has a live preview of exactly which tracks match.
- **Schedule preview.** A dry-run timeline of up to 7 days: which block owns each time segment and which tracks would play — without touching live broadcast state.
- **Station queue.** Push up to 5 specific tracks to play next on the broadcast (public local tracks only), reorder/remove them, and see the queue alongside what the engine has batched.
- **Broadcast restart** and mode switching from the dashboard; the FFmpeg engine self-heals with exponential backoff if it crashes, and batches are homogenized (all-audio or all-video) so concat never fails on mixed streams.

### 4. Going live

Two ways to interrupt the radio with a live broadcast — only one can be on-air at a time, and listeners are switched over automatically:

- **Browser mic broadcast.** Go live straight from the dashboard: the browser captures mic audio and streams 2-second PCM chunks to the server, which encodes to the live HLS output. Built-in backpressure signaling keeps the pipe healthy.
- **External encoder / RTMP, audio (desktop).** One click opens a local RTMP listener with a generated **stream key** for OBS or any encoder. The dashboard shows pending → live state (detected when the encoder actually connects), supports stream-key regeneration, guards the port with reconnect limits, and times out an unclaimed listener after 10 minutes.
- **Live video, paid-tier (desktop to start/stop).** A second, independent RTMP listener (its own port) accepts video+audio from an encoder and transcodes it to a dedicated HLS output that only listeners at or above a chosen minimum tier can load — enforced server-side, not just a UI gate. The creator picks the minimum tier (`subscriber`/`pro`/`all_access`) and a separate go-live notify toggle from dashboard settings; those settings routes work even without the desktop app, so a creator can configure them ahead of ever running it. Supports the same stream-key regeneration and pending → live detection as the audio path, on its own state.
- **Go-live announcements.** Starting either live broadcast fires the station's Discord-compatible webhook (independently toggleable per broadcast type).

### 5. Monetization

- **Provider config at a glance.** The dashboard shows exactly which Stripe/PayPal keys, price IDs, and webhook secrets are configured (never the values), so the creator can see what's wired without touching `.env`.
- **Vault pricing.**
  - Per-**track** pricing: suggested price, minimum, allow-free, one-time or monthly/annual recurring. Setting a price auto-flips the item to `vault`; removing pricing flips it back to public.
  - **Projects**: create named collections (name, description, cover), attach tracks with sort order, and price the bundle as a unit. A track belongs to at most one project.
  - **All-access pass**: a single global product — enable/disable, price floor/suggestion, one-time or recurring, and an independent switch for whether *paid subscription tiers* also include the vault.
- **Highlight.** Pin any track or project into the player's curated drawer.
- **Tip jar configuration.** Exactly three preset amounts (each ≥ $1) plus a custom-amount toggle.
- **Earnings dashboard.** Revenue rollup across every source: per-item unlock revenue with units sold, tip totals with recent tips, and active subscription counts by tier — all in integer cents, with no invented numbers (per-period subscription amounts live at the provider).
- **Webhook event log (desktop).** The last N Stripe/PayPal webhook events with outcomes, for production payment debugging.

### 6. Access tokens (desktop)

- Create labeled tokens at any tier; the raw token is shown once and stored hashed.
- Create **scoped** tokens that unlock exactly one track or one project — shareable per-content passes.
- Change a token's tier, revoke tokens, and list tokens by scope.
- **Assign tokens to accounts.** Bind a token to a listener account by email so the entitlement follows their login rather than a pasteable string; view and remove assignments.

### 7. Private share links

- Mint share links for any track or project, with an optional label and expiry (hours).
- Each link shows its **open count** and last-opened time.
- Delete a link to kill it instantly.

### 8. Creator posts

- Write posts (title optional, body required) as public or supporters-only.
- **Schedule posts** for a future publish time; the release scheduler announces them when due, exactly once.
- **Email supporters** per post (opt-in checkbox per post, requires SMTP): the full post body is emailed to every active subscriber. Scheduled posts remember the choice and honor it at publish time.
- Every publish also announces on the station webhook (title only — the body may be supporters-only).
- Edit and delete posts; publishing edits never re-announce an already-announced post.

### 9. Profile & bio page

- Toggleable public bio panel: bio text, profile picture upload (content-sniffed), and six social links.

### 10. Audience & CRM

- **Listener accounts list** with typeahead (for token assignment and reset links).
- **Password reset links** minted per account for out-of-band delivery — the recovery path that requires zero email infrastructure.
- **Download leads.** The public download page captures emails (deduped, opt-in tracked) and per-download analytics events (platform, artifact, version, UTM source/medium/campaign, referrer, salted IP hash).
- **CSV exports** (all formula-injection-escaped): active subscribers, all listener accounts, download leads, and the consolidated **audience list**.
- **Audience list.** A strictly consent-gated marketing list: welcome-profile emails with `marketing_opt_in` plus download leads with `updates_opt_in`, deduplicated by email and labeled by source — the bridge to any external mailing tool, with no built-in bulk mailer to get the creator in deliverability trouble.

### 11. Analytics

All computed from real listen events (anonymous IP-hashed sessions, seconds-listened accounting):

- **Live:** current listener count and today's peak unique listeners.
- **History:** daily unique listeners, total listen-time, and top track per day, up to 365 days.
- **Top tracks:** by seconds listened over 7/30/90-day windows, with play counts.
- **Subscriber growth:** new subscribers per day and the active-total trend line over up to a year.
- **Play counts:** all-time per-track play totals (also surfaced inline in media lists).

### 12. Station identity & public directory

- **Station registry:** the station's slug and public URL (auto-claimed from `.env`, updatable from the dashboard with strict URL validation, persisted back to `.env`).
- **Cloudflare Tunnel auto-setup (desktop).** As an alternative to running `cloudflared` and pasting a tunnel token by hand, the Station panel accepts a Cloudflare API token (a different, more powerful credential than the tunnel connector token), lists the creator's zones, and on request creates a Named Tunnel, points its ingress at the local server, creates the DNS record, and saves the resulting tunnel token and public URL — the creator still has to run `cloudflared service install` once and restart Paperweight to bring it online; this only automates the Cloudflare-side setup, not running the tunnel client itself.
- **Reachability health check:** the server pings its own public URL from the outside (SSRF-guarded — private/reserved addresses are refused) and reports latency.
- **Directory searchability (desktop):** opting into the public "Paperweight Listen" directory requires three verified conditions — Cloudflare tunnel configured, public URL registered, and the station actually reachable externally. One toggle, honestly enforced.

### 13. Station settings

- **Notification webhook URL** (Discord-compatible) with per-event toggles.
- **Go-live announcement toggle.**
- **RSS feed enable/disable** and scope (podcasts category only, or all public media).
- **Track glow color** — the player's accent color, station-brandable.
- **SMTP status** surfaced so the creator knows whether email features are active.

### 14. Operations & maintenance

- **One-click hot database backup** streamed through the browser (SQLite online backup — safe while the server runs), plus a scheduled/local backup script with retention pruning.
- **Runtime diagnostics:** app version, bind host, proxy trust, and FFmpeg/ffprobe status.
- **Power/update/uninstall controls (desktop).** A power menu can stop/restart the broadcast, or stop/restart the whole app. A check-for-updates button compares against the latest GitHub release and opens the release page for a manual download (no silent auto-update — the app isn't code-signed/notarized yet). Uninstall requires typing the station name to confirm, then exports subscribers/listeners/download-leads CSVs, a full database backup, the vault, `.env`, and logs to a timestamped folder on the Desktop before wiping the app's runtime data and quitting — the installed program files are left for the OS's normal uninstall flow.
- **Radio Host mode (desktop):** flips the station identity between `creator` and `radio_host` presets, with a 3-switch lock to prevent identity thrash.
- **Broadcast mode & restart controls** (see §3).
- **Legal/launch acceptance state.**

---

## Notifications & Outbound Integrations

All outbound messaging is **best-effort and fire-and-forget** — a dead webhook or SMTP hiccup can never block going live, publishing, or releasing:

| Event | Webhook (Discord-compatible) | Supporter email |
|---|---|---|
| Creator goes live | ✅ (toggleable) | — |
| New post published (immediate or scheduled) | ✅ (title only) | ✅ optional, per post |
| Scheduled media release goes public | ✅ | — |
| Listener password reset | — | ✅ (or creator-generated link) |

The webhook URL is SSRF-guarded (URLs resolving to private/reserved addresses are refused), and the email subsystem is a dependency-free pure-Node SMTP client that degrades gracefully when unconfigured.

---

## Public Surfaces Beyond the Player

| Surface | URL | Purpose |
|---|---|---|
| Main player + dashboard | `/` | The whole app (single-file SPA, overridable next to the executable) |
| Live HLS streams | `/hls/stream/`, `/hls/live/` | Station and live-broadcast segments |
| Podcast feed | `/feed.xml`, `/feed/enclosure/:id` | RSS for podcast apps (opt-in) |
| Embed player | `/embed` | Frameable mini player for external sites |
| Share links | `/share/:token` | No-account access to shared tracks/projects |
| Landing pages | `/landing`, `/landing/download`, `/landing/listen`, `/landing/license`, `/landing/content-responsibility` | Marketing site, downloads with lead capture, station directory |
| Health | `/api/health` | Status + station name (used by the directory and reachability checks) |

---

## Deployment, Platforms & Feature Gating

- **Desktop app (Electron)** for Windows (NSIS), macOS (DMG), and Linux (AppImage/deb): graphical first-run setup wizard, system tray, dashboard auto-login.
- **Headless/source installs** for Linux servers and Raspberry Pi (64-bit), with an optional packaged single-file executable.
- **FFmpeg/ffprobe** are the only external dependencies; installers verify or install them.
- **Public exposure** is designed around a Cloudflare Tunnel (documented setup), which is also a hard requirement for directory listing.

Some features are **desktop-only** (token management, schedule-block CRUD, smart playlists, RTMP broadcasting including paid-tier live video start/stop, folder-import collections, external search/import, directory searchability, Cloudflare Tunnel auto-setup, radio-host mode, webhook log, power/update/uninstall controls) — they assume the creator is at their own machine. A small set of routes is **cloud-gated** (`PAPERWEIGHT_CLOUD`) for the future hosted/native-app phase: saved multi-station lists and native-app checkout with deep-link returns. These are inert in self-hosted builds.

---

## Privacy & Security Posture

A condensed inventory of the protections that shape the product experience:

- **Listener privacy by default:** anonymous listening needs no identity; analytics use salted IP hashes, not IPs; marketing lists are strictly opt-in; full data export and self-service deletion are built in; password-reset responses never reveal account existence.
- **Paid-tier email verification:** the first time an account goes paid, a verification email fires and a 24-hour grace period starts; an account that stays unverified past the window loses supporters-only and vault subscriber-tier access until it verifies. Free-tier listeners are never gated on this.
- **Payment integrity:** webhooks are signature-verified (Stripe raw-body verification, PayPal verification API), idempotent via a claim-and-run transaction (an event can never double-apply), and tiers are derived from the provider's own price IDs — never from client-influenced metadata.
- **Access enforcement:** every stream/download/artwork route re-checks entitlement server-side; signed download URLs are context-bound and re-authorized at redemption; download tokens are single-use.
- **Filesystem safety:** all file serving is confined to the vault (`safeVaultPath`), upload names are sanitized, uploads are ffprobe-validated before entering the vault, and images are content-sniffed.
- **SSRF guards** on every creator-configured outbound URL (webhook, health ping).
- **Dashboard hardening:** hashed tokens, session cookies (`SameSite=Strict`), optional TOTP 2FA with replay-proof counters and hashed single-use recovery codes, rate limiting on all auth and payment routes, and CSRF checking.
- **CSV exports** escape spreadsheet formula injection.
- **Operational honesty:** best-effort subsystems (notify, release scheduler) are isolated so their failures never take down streaming or publishing.
