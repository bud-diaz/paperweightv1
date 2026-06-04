# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development (auto-restart on changes)
npm run dev          # nodemon src/index.js

# Production / manual run
npm start            # node src/index.js

# Build Windows executable
npm run build:exe    # packages to dist/ via @yao-pkg/pkg

# Database inspection (no ORM — query directly)
node -e "const db = require('better-sqlite3')('data/paperweight.db'); console.log(db.prepare('SELECT ...').all())"

# Generate a subscriber token from CLI
node scripts/gen-token.js "Label"

# Preflight check (validates FFmpeg, vault, ports)
node scripts/preflight.js
```

No test suite exists.

## Architecture

**Single-process Express server** with three independent subsystems that start at boot:

- **Broadcast engine** (`src/broadcast/`) — spawns an FFmpeg child process that reads a concat manifest and outputs HLS segments to `hls_output/stream/`. Writes a `state.json` to `hls_output/` that the stream API and frontend poll for now-playing info. Manages shuffle/scheduled modes via `playlist.js` and `scheduler.js`.

- **Vault scanner** (`src/scanner/`) — watches `vault/` with chokidar. Three adapter modes (`folder`, `metadata`, `hybrid`) determine how tracks are categorised. Probes new files with `ffprobe` via `probe.js`. Upserts results into the `media` table.

- **HTTP server** (`src/index.js` → `src/api/router.js`) — all API routes live under `/api`. The frontend is a single self-contained SPA (`client/creator.html`) served as the catch-all fallback. No framework; plain Express with `better-sqlite3` for all DB access.

## Database

SQLite at `data/paperweight.db`. Schema lives in `src/db/migrations/` as numbered `.sql` files. **All migrations run on every server startup** — they must be idempotent (`CREATE TABLE IF NOT EXISTS`, `INSERT OR IGNORE`, etc.). Programmatic `ALTER TABLE` guards (can't use `IF NOT EXISTS` in SQLite) live in `src/db/index.js`. Never skip the idempotency requirement when writing a new migration.

Current migration sequence: `001` initial schema → `002` analytics → `003` monetization → `004` slug registry → `005` tips → `006` webhook log → `007` vault pricing (adds `vault_projects`, `vault_project_items`, `vault_prices`, etc.) → `008` renames `private` visibility to `vault`.

## Auth & Access Tiers

**Listener auth** — `pw_token` httpOnly cookie set by `POST /api/tokens/redeem` or `POST /api/listener/login`. The `attachTier` middleware (`src/auth/middleware.js`) runs on every request and sets `req.tier` to `free | subscriber | pro | all_access`. Also accepts `Authorization: Bearer <token>` for mobile clients. Tier is validated against `subscriptions.current_period_end` for Stripe-linked accounts.

**Listener accounts** (`src/api/listener.js`) — email + bcrypt password, no email verification. On login/register, the server issues (or reuses) a token from the `tokens` table linked via `listener_id`. This is how durable access works: listeners log in instead of pasting token strings.

**Dashboard auth** — separate `X-Dashboard-Token` header checked against `config.auth.dashboardToken` (set in `.env`). Never uses `pw_token`.

**CSRF** (`src/middleware/csrfCheck.js`) — origin/referer check on unsafe methods that carry a `pw_token` cookie. Mobile Bearer-token requests bypass it.

**Vault access chain** (`src/auth/vault.js`, `canAccessVaultContent`) — for `visibility = 'vault'` content: all_access subscriber bypass → all_access unlock → project unlock → per-track unlock → deny with pricing options.

## Key Paths & Config

`src/config.js` distinguishes two root paths:
- `config.paths.app` (`appRoot`) — read-only; where `client/` and `src/` live. Inside the pkg snapshot when packaged.
- `config.paths.root` (`dataRoot`) — writable; next to the `.exe` when packaged, same as project root in dev. Used for `.env`, `vault/`, `data/`, `logs/`, `hls_output/`.

The SPA fallback in `src/index.js` checks `dataRoot/client/creator.html` first so users can drop replacement frontend files next to the exe without rebuilding the package.

## Frontend

`client/creator.html` is the **entire frontend** — one self-contained HTML file with an inline `<script>` block (~1500 lines of vanilla JS). It does not import any local `.js` files. The old multi-page JS files (`library.js`, `player.js`, etc.) still exist on disk but are unused.

Key frontend state variables: `stationName`, `LIBRARY`, `LIBRARY_STRUCTURE`, `state` (player state object). The `render()` function is the single re-render entry point for player UI. Library data comes from `GET /api/library/structure` (project-grouped) not the old `GET /api/library`.

## Visibility States

`media.visibility`: `public` | `supporters_only` | `vault`
- `public` — visible to all
- `supporters_only` — visible to subscriber+ tiers and scoped-token holders
- `vault` — shown in library with lock UI; access requires payment or unlock token
