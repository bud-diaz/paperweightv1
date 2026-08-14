# Paperweight v1 ↔ System.Pape Alignment Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Make the `paperweightv1` codebase intentionally match what `/home/bud/system.pape` expects from Paperweight stations, public directory/search, download analytics, telemetry, and tunnel provisioning.

**Architecture:** Treat System.Pape as the upstream contract owner and Paperweight v1 as the station/client implementation. Add an explicit shared contract document, tests that assert payload/response shapes on both sides, and a terminology guardrail so `projects`, `collections`, `stations`, and `directory` cannot keep drifting. Do not turn Paperweight v1 into a SaaS or merge System.Pape auth/data into it.

**Tech Stack:** Paperweight v1: Node/Express, SQLite, node:test. System.Pape: pnpm monorepo, Next/Hono, Drizzle/Postgres, TypeScript.

---

## Source-of-truth terminology

Use this map everywhere before touching code:

| Term | Lives in | Means | Do not confuse with |
|---|---|---|---|
| **Paperweight station** | Paperweight v1 + System.Pape `pw_stations` | One self-hosted creator install broadcasting/reporting telemetry | System.Pape project |
| **System.Pape project** | System.Pape `projects` module | Internal company initiative/workstream with notes/tasks/decisions/repos | Paperweight creator collection |
| **Paperweight collection** | Paperweight v1 UI language | Creator-facing bundle/album/playlist-like grouping of tracks | System.Pape project |
| **Paperweight vault project** | Paperweight v1 DB legacy/internal table names: `vault_projects`, `vault_project_items` | Historical/internal implementation for paid content groupings | Public-facing “project” wording |
| **Directory/search** | System.Pape Paperweight module | Public station discovery from opted-in telemetry | Creator content collection browsing |
| **Download analytics** | Landing page → Paperweight Vercel proxy → System.Pape | Public-site download events/leads | Station telemetry snapshots |
| **Telemetry ingest** | Paperweight station → System.Pape `/api/modules/paperweight/ingest` | Periodic station metrics, identity, listing eligibility | Download analytics |

Rule: code may keep legacy DB names like `vault_projects`, but user-facing copy, API contract docs, and tests should call creator bundles **collections** unless the endpoint is deliberately legacy/internal.

---

## Phase 0 — Safety and baseline

### Task 0.1: Record both repo states before changing anything

**Objective:** Preserve Bud's current work and avoid mixing unrelated dirty state into this alignment pass.

**Files:** none.

**Steps:**
1. Run:
   ```bash
   cd /home/bud/paperweightv1
   git status --short --branch
   git diff --stat
   ```
2. Run:
   ```bash
   cd /home/bud/system.pape
   git status --short --branch
   git diff --stat
   ```
3. If dirty files exist, classify them as:
   - intentional active work to preserve;
   - generated artifact churn;
   - unrelated accidental file.
4. Do not edit unrelated dirty files.

**Verification:** Final implementation report includes both starting branch/status summaries.

---

## Phase 1 — Contract inventory

### Task 1.1: Create a canonical integration contract doc in Paperweight v1

**Objective:** Put System.Pape's current expectations into one contract file that Paperweight v1 maintainers can read before editing telemetry/search/tunnel code.

**Files:**
- Modify/create: `/home/bud/paperweightv1/docs/system-pape-contract.md`
- Reference: `/home/bud/system.pape/apps/web/src/modules/paperweight/router.ts`
- Reference: `/home/bud/system.pape/apps/web/src/modules/paperweight/service.ts`
- Reference: `/home/bud/system.pape/packages/db/src/schema/paperweight.ts`
- Reference: `/home/bud/paperweightv1/docs/system-pape-directory.md`

**Required content:**
1. Endpoint table:
   - `POST /api/modules/paperweight/register`
   - `POST /api/modules/paperweight/ingest`
   - `POST /api/modules/paperweight/frp/tunnel/create`
   - `DELETE /api/modules/paperweight/frp/tunnel`
   - `POST /api/modules/paperweight/tunnel/create`
   - `DELETE /api/modules/paperweight/tunnel`
   - `GET /api/modules/paperweight/stations?q=&limit=`
   - `GET /api/modules/paperweight/directory`
   - `POST /api/download-lead`
   - `POST /api/download-events`
   - `GET /api/download-analytics/summary`
2. Request/response JSON shapes.
3. Auth headers:
   - telemetry/tunnel: `x-telemetry-secret`
   - download analytics: `x-analytics-secret` when configured
4. Ownership rules:
   - `stationKey` is stable station identity.
   - `slug` is globally unique public hostname identity.
   - They are often equal but never aliases.
5. Freshness/listing rules:
   - station search currently uses 15-minute `SEARCHABLE_WINDOW_MS`.
   - directory currently uses 30-minute `ACTIVE_WINDOW_MS`; decide in Task 2.4 whether to make it 15 to match docs.
6. Explicit term map from the table above.

**Verification:** Run:
```bash
cd /home/bud/paperweightv1
grep -n "stationKey" docs/system-pape-contract.md
grep -n "collections" docs/system-pape-contract.md
grep -n "POST /api/modules/paperweight/ingest" docs/system-pape-contract.md
```
Expected: all three commands find relevant contract sections.

---

### Task 1.2: Link contract docs from contributor guidance

**Objective:** Make future agents/devs see the contract before changing integration code.

**Files:**
- Modify: `/home/bud/paperweightv1/AGENTS.md`
- Modify: `/home/bud/paperweightv1/docs/system-pape-directory.md`

**Steps:**
1. Add a short “System.Pape integration contract” section to `AGENTS.md` near Architecture/Auth.
2. Link `docs/system-pape-contract.md`.
3. Add the terminology warning: `collections` are creator-facing content groupings; System.Pape `projects` are internal operational workstreams.
4. At the top of `docs/system-pape-directory.md`, add: “For the full current integration contract, see `docs/system-pape-contract.md`.”

**Verification:** Run:
```bash
cd /home/bud/paperweightv1
grep -n "system-pape-contract" AGENTS.md docs/system-pape-directory.md
grep -n "collections" AGENTS.md
```
Expected: links and terminology warning are present.

---

## Phase 2 — Align telemetry payloads and System.Pape ingestion

### Task 2.1: Write Paperweight v1 payload-shape test

**Objective:** Lock Paperweight v1's telemetry payload to the System.Pape contract.

**Files:**
- Modify: `/home/bud/paperweightv1/test/http.test.js` or create `/home/bud/paperweightv1/test/system-pape-contract.test.js`
- Reference: `/home/bud/paperweightv1/src/telemetry/reporter.js`

**Test cases:**
1. `buildPayload()` includes exactly the core fields System.Pape consumes:
   ```js
   [
     'stationKey', 'slug', 'name', 'publicUrl', 'searchable', 'version', 'platform',
     'listeners', 'uniqueListenersToday', 'totalTokens', 'subscribers', 'pro',
     'allAccess', 'totalTracks', 'vaultTracks', 'broadcasting', 'currentTrack',
     'grossCents'
   ]
   ```
2. `stationKey` fallback order is stable:
   - `STATION_KEY`
   - `STATION_SLUG`
   - generated `pwinst_...`
3. `searchable` reads `station_searchable` per call, not once at boot.
4. `publicUrl` prefers explicit `STATION_PUBLIC_URL`, then derives `https://<slug>.paperweighthq.com`.

**Important:** `funnelMilestones` currently appears in Paperweight v1's payload, but System.Pape's current `IngestPayload` does not consume it. The test should either mark it as “extra ignored field” or pair with Task 2.2 if System.Pape should actually persist it.

**Verification:** Run:
```bash
cd /home/bud/paperweightv1
npm test -- --test-name-pattern="telemetry|system.pape|station"
```
Expected: focused telemetry tests pass.

---

### Task 2.2: Decide and fix `funnelMilestones` contract drift

**Objective:** Resolve the current mismatch where Paperweight v1 sends `funnelMilestones` but System.Pape ignores it.

**Files:**
- Paperweight side: `/home/bud/paperweightv1/src/telemetry/reporter.js`
- System.Pape side if keeping: `/home/bud/system.pape/packages/db/src/schema/paperweight.ts`
- System.Pape side if keeping: `/home/bud/system.pape/apps/web/src/modules/paperweight/service.ts`
- System.Pape migrations if keeping: `/home/bud/system.pape/packages/db/src/migrations/*`

**Decision options:**
1. **Keep but explicitly ignore for now:** document `funnelMilestones` as experimental/ignored in `docs/system-pape-contract.md`, and add a System.Pape router/service test proving extra payload fields do not break ingest.
2. **Persist it now:** add a `pw_station_funnel_milestones` table keyed by station + event type, update ingest service to upsert milestones, and expose aggregate activation funnel metrics.
3. **Remove from payload for now:** delete it from Paperweight v1 reporter until System.Pape has a real consumer.

**Recommended default:** Option 1 unless Bud explicitly wants activation funnel analytics inside System.Pape now. It avoids scope expansion while making the drift visible.

**Verification:**
- Option 1: System.Pape ingest test passes with extra `funnelMilestones` field.
- Option 2: migration + typecheck + service tests pass.
- Option 3: Paperweight telemetry payload-shape test proves it is absent.

---

### Task 2.3: Add System.Pape ingest contract tests

**Objective:** Prove System.Pape accepts the payload Paperweight v1 sends and rejects the dangerous cases.

**Files:**
- Create/modify: `/home/bud/system.pape/apps/web/src/modules/paperweight/contract.test.ts` or nearest existing paperweight test file.
- Reference: `/home/bud/system.pape/apps/web/src/modules/paperweight/service.ts`
- Reference: `/home/bud/system.pape/apps/web/src/modules/paperweight/router.ts`

**Test cases:**
1. `ingestStationReport()` creates a station and snapshot from the full Paperweight v1 payload.
2. Same `stationKey` can update same `slug`.
3. Different `stationKey` cannot claim an already-owned `slug`; returns 409 shape.
4. Invalid/reserved slug is stripped or rejected according to current service behavior.
5. `searchable:false` de-indexes on next report.
6. Extra unknown fields do not corrupt stored rows.

**Verification:** Run:
```bash
cd /home/bud/system.pape
pnpm -r typecheck
pnpm build
```
Expected: typecheck/build pass. If a local test runner exists for module tests, run that too and record command/output.

---

### Task 2.4: Resolve directory freshness inconsistency

**Objective:** Make docs and code agree on how long stale stations remain listed.

**Current finding:**
- `searchStations()` uses 15 minutes (`SEARCHABLE_WINDOW_MS`).
- `getDirectory()` uses 30 minutes (`ACTIVE_WINDOW_MS`).
- `docs/system-pape-directory.md` says public directory freshness should be approximately 15 minutes.

**Files:**
- Modify: `/home/bud/system.pape/apps/web/src/modules/paperweight/service.ts`
- Modify if needed: `/home/bud/paperweightv1/docs/system-pape-contract.md`
- Modify if needed: `/home/bud/paperweightv1/docs/system-pape-directory.md`

**Recommended fix:** Use `SEARCHABLE_WINDOW_MS` for both `getDirectory()` and `searchStations()` unless there is a deliberate reason to keep `GET /directory` looser than `GET /stations`.

**Verification:** Add/adjust a System.Pape service test where a station last seen 20 minutes ago is omitted from both `directory` and `stations` when `searchable:true`.

---

## Phase 3 — Align station registration and tunnel provisioning

### Task 3.1: Lock Paperweight v1 registration/tunnel request shape

**Objective:** Ensure dashboard flows send the exact body/header System.Pape expects.

**Files:**
- Modify tests around `/home/bud/paperweightv1/src/api/dashboard.js`
- Reference routes near:
  - `/api/dashboard/station/cloudflare/paperweighthq/create`
  - FRP one-click route(s)
  - telemetry self-registration route(s)

**Test cases:**
1. Registration sends `{ slug, stationKey, secret }` to `/api/modules/paperweight/register`.
2. FRP tunnel creation sends `{ slug, stationKey }` to `/api/modules/paperweight/frp/tunnel/create` with `x-telemetry-secret`.
3. Cloudflare tunnel creation sends `{ slug, stationKey }` to `/api/modules/paperweight/tunnel/create` with `x-telemetry-secret`.
4. Returned FRP fields are persisted to `.env`/config consistently:
   - `PAPERWEIGHT_TUNNEL_PROVIDER=frp`
   - `FRP_SERVER_ADDR`
   - `FRP_SERVER_PORT`
   - `FRP_AUTH_TOKEN` / `FRP_TUNNEL_TOKEN` according to current code naming
   - `FRP_PROXY_NAME`
   - `FRP_SUBDOMAIN`
   - `STATION_PUBLIC_URL`
5. No Cloudflare-only DOM handler breaks FRP station panel wiring.

**Verification:** Run Paperweight focused HTTP/dashboard tests:
```bash
cd /home/bud/paperweightv1
npm test -- --test-name-pattern="paperweighthq|frp|telemetry|station"
```

---

### Task 3.2: Lock System.Pape tunnel ownership behavior

**Objective:** Prove tunnel provisioning cannot create/rotate/delete a slug owned by another station.

**Files:**
- Modify/create System.Pape paperweight tunnel tests near `/home/bud/system.pape/apps/web/src/modules/paperweight/*test.ts`
- Reference: `/home/bud/system.pape/apps/web/src/modules/paperweight/service.ts`

**Test cases:**
1. `createOrRotateFrpTunnel({ stationKey, slug })` returns 409 if slug is unclaimed.
2. It returns 409 if slug belongs to a different stationKey.
3. It returns provider/hostname/server/auth/proxy fields when owner matches.
4. It stores only token hash, not plaintext token.
5. `deleteFrpTunnel()` clears FRP fields only for owner.
6. Same equivalent set for Cloudflare if the test harness already supports fake Cloudflare client.

**Verification:** Run:
```bash
cd /home/bud/system.pape
pnpm -r typecheck
pnpm build
```

---

## Phase 4 — Align download analytics bridge

### Task 4.1: Document and test Paperweight public-site proxy payloads

**Objective:** Make sure launch/download analytics still match System.Pape's public analytics router.

**Files:**
- Paperweight v1:
  - `/home/bud/paperweightv1/landing/download.html`
  - `/home/bud/paperweightv1/api/download-lead.js`
  - `/home/bud/paperweightv1/api/download-events.js`
  - `/home/bud/paperweightv1/api/_analytics-proxy.js`
- System.Pape:
  - `/home/bud/system.pape/apps/web/src/modules/paperweight/public-router.ts`
  - `/home/bud/system.pape/apps/web/src/modules/paperweight/analytics.ts`

**Test cases:**
1. Lead payload supports `email`, `platform`, `updatesOptIn`.
2. Event payload supports `platform`, `artifact`, `version`, `source`, `medium`, `campaign`, `referrer`.
3. `PAPERWEIGHT_ANALYTICS_SECRET` is forwarded server-side only and never exposed in `landing/download.html`.
4. System.Pape returns:
   - 401 for missing/bogus secret when configured.
   - 200 for valid lead/event.
   - 405 for wrong method where appropriate.

**Verification:**
```bash
cd /home/bud/paperweightv1
npm run check:analytics
npm test -- --test-name-pattern="download|analytics"

cd /home/bud/system.pape
pnpm -r typecheck
pnpm build
```

---

## Phase 5 — Kill terminology drift before it becomes another rabbit hole

### Task 5.1: Add a terminology audit script

**Objective:** Automatically flag risky public/user-facing use of `project(s)` in Paperweight v1 where `collection(s)` should probably be used.

**Files:**
- Create: `/home/bud/paperweightv1/scripts/check-terminology.js`
- Modify: `/home/bud/paperweightv1/package.json`

**Script behavior:**
1. Scan user-facing/documentation files:
   - `client/**/*.html`
   - `landing/**/*.html`
   - `README.md`
   - `docs/**/*.md`
2. Flag `project`/`projects` unless line matches an allowlist.
3. Allowlist technical/internal terms:
   - `vault_projects`
   - `vault_project_items`
   - `project_id`
   - `project unlock`
   - explicit historical notes explaining legacy naming
   - System.Pape project references inside this contract plan/doc
4. Print file:line and surrounding text.
5. Exit non-zero on unallowlisted public-facing hits.

**Package script:**
```json
{
  "scripts": {
    "check:terminology": "node scripts/check-terminology.js"
  }
}
```

**Verification:** Run:
```bash
cd /home/bud/paperweightv1
npm run check:terminology
```
Expected: either passes or prints a small intentional list to fix/allowlist.

---

### Task 5.2: Add terminology check to package/release gate

**Objective:** Keep the project/collection confusion from recurring.

**Files:**
- Modify: `/home/bud/paperweightv1/package.json`
- Possibly modify: `/home/bud/paperweightv1/scripts/check-package.js` or release script composition depending current script layout.

**Steps:**
1. Add `npm run check:terminology` to the relevant pre-release gate.
2. Prefer including it in `release:check` and optionally `check:package` if package checks already aggregate static asset rules.
3. Keep this check narrow; do not block internal DB/code identifiers that would require a risky migration.

**Verification:** Run:
```bash
cd /home/bud/paperweightv1
npm run check:terminology
npm run check:package
```
Expected: both pass.

---

## Phase 6 — Cross-repo verification harness

### Task 6.1: Create a Paperweight-side contract probe script

**Objective:** Give Bud one command in Paperweight v1 that checks whether a System.Pape instance looks compatible without requiring a full production deploy.

**Files:**
- Create: `/home/bud/paperweightv1/scripts/check-system-pape-contract.js`
- Modify: `/home/bud/paperweightv1/package.json`

**Script behavior:**
1. Read `PAPE_URL` from env, default to `https://system.paperweighthq.com` only if explicitly allowed by `--hosted`.
2. Probe public GET endpoints without secrets:
   - `/api/health`
   - `/api/modules/paperweight/slugs/validate?slug=contract-test`
   - `/api/modules/paperweight/stations?q=contract-test&limit=1`
3. If `PAPE_TELEMETRY_SECRET` is set, run a non-persistent or disposable-station ingest probe only against local/staging System.Pape, never production unless `--write` is explicitly passed.
4. Print a clear compatibility report.
5. Redact secrets in output.

**Package script:**
```json
{
  "scripts": {
    "check:system-pape": "node scripts/check-system-pape-contract.js"
  }
}
```

**Verification:**
```bash
cd /home/bud/paperweightv1
PAPE_URL=http://127.0.0.1:3002 npm run check:system-pape
```
Expected: public endpoints report compatible if local System.Pape is running; otherwise script clearly reports connection failure without crashing unclearly.

---

### Task 6.2: Add cross-repo manual QA checklist

**Objective:** Keep a human-readable release checklist for alignment issues that automated tests cannot fully prove.

**Files:**
- Modify/create: `/home/bud/paperweightv1/docs/system-pape-contract.md`
- Possibly modify: `/home/bud/paperweightv1/RELEASE_CHECKLIST.md`

**Checklist items:**
1. New Paperweight station can generate/register telemetry secret.
2. First ingest creates/updates `pw_stations` in System.Pape.
3. Searchability off → station absent from `/stations` after next report.
4. Searchability on + reachable public URL → station appears in `/stations`.
5. FRP one-click returns hostname and app persists config.
6. Download page lead/event reaches System.Pape analytics summary.
7. No public UI copy calls creator collections “projects” unless explicitly technical/legacy.
8. No dashboard/log output exposes telemetry or analytics secrets.

**Verification:** Link this checklist from `RELEASE_CHECKLIST.md`.

---

## Phase 7 — Full verification before implementation is called done

### Task 7.1: Run Paperweight v1 gates

**Objective:** Prove the public app still works after contract/terminology changes.

**Commands:**
```bash
cd /home/bud/paperweightv1
node scripts/generate-client-bundle.js
npm run check:terminology
npm run check:package
npm test
```

**Expected:** All pass. If `release:check` is blocked only by known unrelated dirty icon/build assets, say that explicitly.

---

### Task 7.2: Run System.Pape gates

**Objective:** Prove System.Pape still builds and its Paperweight module remains compatible.

**Commands:**
```bash
cd /home/bud/system.pape
pnpm -r typecheck
pnpm build
```

**Expected:** Both pass. If migrations are added, run:
```bash
pnpm db:generate
pnpm db:migrate
```
Only run DB migrations after confirming the intended target DB.

---

### Task 7.3: Final integration report

**Objective:** Leave Bud with a useful alignment summary, not a vague “done”.

**Report must include:**
1. Files changed in each repo.
2. Contract mismatches found and resolved.
3. Any intentionally unresolved mismatch, especially `funnelMilestones` if not persisted.
4. Test commands run with real pass/fail output.
5. Remaining blockers, if any.
6. Terminology guard result: whether public-facing `projects` references remain and why.

---

## Acceptance criteria

This alignment pass is done when:

- `docs/system-pape-contract.md` exists and is linked from contributor/release docs.
- Paperweight v1 has tests locking telemetry, station registration, tunnel, and download-analytics request shapes.
- System.Pape has tests locking ingest, search/directory freshness, slug ownership, and tunnel provisioning behavior.
- Any `funnelMilestones` drift is explicitly documented, removed, or persisted.
- Public/user-facing Paperweight v1 copy uses **collections** for creator content groupings unless the context is an internal DB/API legacy note.
- `npm test` passes in Paperweight v1.
- `pnpm -r typecheck` and `pnpm build` pass in System.Pape.
- Secrets are not printed, committed, or exposed to frontend code.

---

## Suggested commit sequence

1. `docs: add system pape contract for paperweight`
2. `test: lock paperweight telemetry contract`
3. `test: lock system pape paperweight ingest contract`
4. `fix: align station directory freshness`
5. `test: lock paperweight tunnel contract`
6. `chore: add paperweight terminology guard`
7. `docs: link system pape alignment checklist`

Keep commits small. If a task touches both repos, commit separately in each repo unless the final delivery is a coordinated PR pair.
