# AGENTS.md

Guidance for Codex when working in this repository.

## Commands

```bash
npm run dev              # nodemon src/index.js
npm start                # node src/index.js
npm run preflight        # environment and runtime readiness check
npm run check:migrations # migration idempotency check
npm run check:scheduler  # scheduler edge-case check
npm run check:analytics  # analytics write-path check
npm run check:package    # package metadata and asset check
npm run smoke            # HTTP smoke test against a running server
npm run build:exe        # build Windows executable into dist/

node scripts/gen-token.js "Label"
node -e "const db = require('better-sqlite3')('data/paperweight.db'); console.log(db.prepare('SELECT ...').all())"
```

There is no full test suite. The release checks above are the current minimum safety net.

## Architecture

Paperweight is a single-process Express server with three boot-time subsystems:

- Broadcast engine (`src/broadcast/`): spawns FFmpeg, reads a concat manifest, writes HLS output to `hls_output/stream/`, and writes now-playing state to `hls_output/state.json`.
- Vault scanner (`src/scanner/`): watches `vault/` with chokidar, probes files with ffprobe, and upserts media rows.
- HTTP server (`src/index.js` -> `src/api/router.js`): all API routes live under `/api`; the single-file frontend is `client/creator.html`.

Plain Express and `better-sqlite3` are used directly. There is no ORM.

## Database

SQLite lives at `data/paperweight.db`.

Schema files live in `src/db/migrations/`. Applied SQL migrations are tracked in the `schema_migrations` table and should run once. Startup also runs guarded programmatic ALTER checks in `src/db/index.js` for SQLite changes that cannot use `IF NOT EXISTS`.

Current migration sequence:

`001` initial schema -> `002` analytics -> `003` monetization -> `004` slug registry -> `005` tips -> `006` webhook log -> `007` vault pricing -> `008` private-to-vault rename -> `009` token assignments.

Never add recurring destructive SQL to a migration file. Do not use `DROP TABLE media` or table rebuilds in automatically applied SQL migrations.

## Auth And Access

Listener auth:

- `pw_token` httpOnly cookie from `POST /api/tokens/redeem` or `POST /api/listener/login`.
- Bearer token support for mobile clients.
- `attachTier` sets `req.tier` to `free`, `subscriber`, `pro`, or `all_access`.

Dashboard auth:

- `X-Dashboard-Token` only.
- Token comes from `.env` as `DASHBOARD_TOKEN`.
- Listener cookies never grant dashboard access.

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

## Before Packaging

Run the release checklist in `RELEASE_CHECKLIST.md`. At minimum:

```bash
npm run preflight
npm run check:migrations
npm run check:scheduler
npm run check:analytics
npm run check:package
npm audit --omit=dev
```
