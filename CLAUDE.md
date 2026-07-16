# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Commands

```bash
npm run dev              # nodemon src/index.js
npm start                # node src/index.js
npm test                 # unit and HTTP tests (scheduler, access, payment, http)
npm run preflight        # environment and runtime readiness check
npm run check:migrations # migration idempotency check
npm run check:scheduler  # scheduler edge-case check
npm run check:analytics  # analytics write-path check
npm run check:package    # package metadata and asset check
npm run check:clean      # release cleanliness check
npm run release:check    # full pre-release gate (clean + tests + preflight + all checks + audit)
npm run backup           # hot SQLite backup to data/backups/ (safe while running)
npm run smoke            # HTTP smoke test against a running server
npm run smoke:exe        # executable clean-folder smoke test
npm run build:exe        # optional convenience executable packaging

node scripts/gen-token.js "Label"
node -e "const db = require('better-sqlite3')('data/paperweight.db'); console.log(db.prepare('SELECT ...').all())"
```

## Architecture

Paperweight is a single-process Express server with four boot-time subsystems:

- Broadcast engine (`src/broadcast/`): spawns FFmpeg, reads a concat manifest, writes HLS output to `hls_output/stream/`, and writes now-playing state to `hls_output/state.json`.
- Vault scanner (`src/scanner/`): watches `vault/` with chokidar, probes files with ffprobe, and upserts media rows.
- Release scheduler (`src/release/scheduler.js`): a 30s `setInterval` poll that flips scheduled `media.visibility` to `public` once `release_at` passes and fires the deferred notify for creator posts scheduled via `published_at`. Unrelated to `src/broadcast/scheduler.js` (weekly dayparting for the live broadcast, checked by `npm run check:scheduler`) — different subsystem, same name coincidence.
- HTTP server (`src/index.js` -> `src/api/router.js`): all API routes live under `/api`; the single-file frontend is `client/creator.html`. Three public non-API routes are mounted directly in `src/index.js`: `/feed.xml` + `/feed/enclosure/:id` (creator-enabled RSS feed, `src/api/feed.js`) and `/embed` (frameable mini player, `client/embed.html` + `client/js/embed.js`).

Supporting modules:

- `src/email/`: pure-Node SMTP client (no new deps) configured by `SMTP_*` env vars; email features degrade gracefully when unconfigured (`isEmailConfigured()`).
- `src/notify/`: best-effort outbound notifications — Discord-compatible webhook on go-live/new post/media release, optional supporter email on post publish. Never blocks the triggering request.
- `src/runtime/net-guard.js`: SSRF guard for owner-configured URLs (station health ping, notify webhook).
- `src/runtime/datetime.js`: normalizes creator-submitted ISO datetime strings to SQLite's own `datetime('now')` format so scheduled-release comparisons stay plain SQL.
- `src/runtime/cloudflare.js`: pure-Node (no new deps) Cloudflare REST API client (`https`, no MCP/OAuth involved) backing the dashboard's optional `CLOUDFLARE_API_TOKEN`-driven "auto-create tunnel" flow (`PUT/GET/POST /api/dashboard/station/cloudflare/*` in `src/api/dashboard.js`) — creates a Named Tunnel + DNS route on request and persists the resulting `CLOUDFLARE_TUNNEL_TOKEN`/`STATION_PUBLIC_URL`. Distinct from the root `.mcp.json` (registers Cloudflare's MCP server for maintainer use in Claude Code sessions only — no shipped-product involvement).
- `scripts/backup.js` (`npm run backup`): hot SQLite backup with pruning; `GET /api/dashboard/backup` streams one through the browser.

Plain Express and `better-sqlite3` are used directly. There is no ORM.

## Database

SQLite lives at `data/paperweight.db`.

Schema files live in `src/db/migrations/`. Applied SQL migrations are tracked in the `schema_migrations` table and should run once. Startup also runs guarded programmatic ALTER checks in `src/db/index.js` for SQLite changes that cannot use `IF NOT EXISTS`.

Current migration sequence:

`001` initial schema -> `002` analytics -> `003` monetization -> `004` slug registry -> `005` tips -> `006` webhook log -> `007` vault pricing -> `008` private-to-vault rename -> `009` token assignments -> `010` webhook idempotency -> `011` payment idempotency -> `012` dashboard 2FA -> `013` creator profile -> `014` launch acceptance -> `015` download leads -> `016` highlight -> `017` share links -> `018` smart playlists -> `019` creator posts -> `020` download lead opt-in -> `021` pending checkouts -> `022` download events -> `023` password resets -> `024` app settings -> `025` genre + offline saves -> `026` listener profiles -> `027` listener email tokens.

The source of truth for migrations is the inline SQL in `src/db/migrations/index.js`; the standalone `.sql` files are documentation copies. Small creator-configurable flags (notify webhook URL, feed enablement, `station_searchable`) live in the `app_settings` key/value table via `src/db/settings.js`.

Release scheduling columns (added via guarded `ALTER TABLE` in `src/db/index.js`, not a numbered migration — plain column additions follow that existing pattern): `media.release_at` (nullable; when set and due, the release scheduler flips `visibility` to `public` and clears it), `creator_posts.notify_supporters` (persists the email-supporters choice so a scheduled post can still honor it later), `creator_posts.release_notified_at` (marks when notify fired, so a scheduled post is announced exactly once).

Listener email/verification/tip-supporter columns (also guarded `ALTER TABLE` in `src/db/index.js`): `listener_accounts.email_verified_at` (set when a verify or tip auto-login link is clicked), `listener_accounts.email_verification_required_at` (set once, the first time an account goes paid while unverified — starts the 24h grace window enforced in `src/auth/access.js`; `NULL` grandfathers accounts that were already paid before this shipped), `listener_accounts.settings_tour_seen_at` (marks the one-time Settings spotlight dismissed), `tips.donor_name` / `tips.donor_email` (optional identity captured on the tip form; both `NULL` means anonymous). `subscriptions.provider` CHECK is widened (guarded rebuild, same pattern as the `005` tier widen) to include `'tip'`, for the 7-day supporter-tier grant a tip-with-email creates.

Never add recurring destructive SQL to a migration file. Do not use `DROP TABLE media` or table rebuilds in automatically applied SQL migrations.

## Auth And Access

Listener auth:

- `pw_token` httpOnly cookie from `POST /api/tokens/redeem` or `POST /api/listener/login`.
- Bearer token support for mobile clients.
- `attachTier` sets `req.tier` to `free`, `subscriber`, `pro`, or `all_access`.

Dashboard auth:

- Login via `POST /api/auth/dashboard/login` with `X-Dashboard-Token` header → issues `pw_dashboard_session` httpOnly cookie (24h, in-memory).
- If 2FA is enabled, login returns `{requires2FA, challenge}` and the client must follow up with `POST /api/auth/dashboard/verify-2fa`.
- `requireDashboard` middleware checks `pw_dashboard_session` cookie first, then falls back to `X-Dashboard-Token` header only when 2FA is disabled.
- Token comes from `.env` as `DASHBOARD_TOKEN`. Listener cookies never grant dashboard access.
- 2FA TOTP secret and recovery codes stored in `dashboard_2fa` table (migration 012). Pure Node crypto — no new deps.

Access policy lives in `src/auth/access.js`. Use it for new media/library/download gates instead of duplicating tier checks.

Vault access for `visibility = 'vault'` uses scoped tokens, all-access inclusion, project unlocks, track unlocks, and pricing options.

## Frontend

`client/creator.html` is the main player and dashboard UI. It is a large single-file vanilla JS frontend. Avoid adding new local JS files unless you are intentionally changing the serving model.

Key frontend state variables include `stationName`, `LIBRARY`, `LIBRARY_STRUCTURE`, and `state`.

Library data comes from `GET /api/library/structure`.

## Runtime Paths

`src/config.js` distinguishes:

- `config.paths.app`: read-only app files (`src/`, `client/`, package metadata).
- `config.paths.root`: writable runtime root next to the executable in packaged mode.

Runtime data:

- `.env`
- `vault/`
- `data/`
- `logs/`
- `hls_output/`

The SPA fallback checks `dataRoot/client/creator.html` before the bundled frontend so users can override frontend files next to the executable.

`PUT /api/dashboard/station/searchable` is desktop-only and verifies Cloudflare tunnel configuration, public URL registration, and external reachability before enabling directory searchability.

`landing/listen.html` is the standalone public station search/player page; Express serves it at `/landing/listen`, while Vercel clean URLs serve it as `/listen`.

## Before Packaging

Run the release checklist in `RELEASE_CHECKLIST.md`. The single gate is:

```bash
npm run release:check
```

That runs: release cleanliness check, tests, preflight, migration/scheduler/analytics/package checks, and `npm audit --omit=dev`. Then smoke the executable if building one:

```bash
npm run smoke:exe
```

## Desktop Packaging

There are two separate desktop packaging paths — do not conflate them:

- `scripts/build-exe.js` (`npm run build:exe`) produces a headless `@yao-pkg/pkg`
  binary for **Linux x64 / Raspberry Pi ARM64 only**. It just starts the server and
  opens a browser tab; there is no installer.
- `electron/` is the **Windows/macOS/Linux desktop app** (Electron + electron-builder:
  NSIS on Windows, DMG on macOS, AppImage + deb on Linux). It has a graphical
  first-run setup wizard (`electron/setup-window.js` + shared `src/setup/provision.js`),
  a system tray, and auto-login into the dashboard. Build it with
  `cd electron && npm run dist` (Windows/macOS) or `npm run dist:linux` (Linux).
  It is not code-signed/notarized yet — see TROUBLESHOOTING.md.

`src/config.js` distinguishes the two at runtime via `process.pkg` (`isPackaged`)
vs. `process.env.PAPERWEIGHT_ELECTRON` (`isElectron`); they never run in the same
process.
