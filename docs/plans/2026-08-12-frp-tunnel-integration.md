# FRP Tunnel Integration Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Replace the Paperweight-owned `paperweighthq.com` vanity tunnel path from Cloudflare-managed tunnels to a self-owned FRP tunnel gateway while preserving the creator UX: `https://<slug>.paperweighthq.com`.

**Architecture:** Run a Paperweight-controlled VPS tunnel gateway using `frps` behind Caddy/Traefik wildcard TLS. Paperweight stations run a supervised `frpc` connector process locally. `system.pape` owns slug authorization and issues per-station FRP credentials/config; `paperweightv1` requests those credentials after telemetry registration, persists them to `.env`, and supervises the `frpc` child process the same way it currently supervises `cloudflared`.

**Tech Stack:** Paperweight v1 Node/Express/Electron, System.Pape Next/Hono/Drizzle/Postgres, FRP (`frps`/`frpc`), Caddy or Traefik, wildcard DNS, node:test.

---

## Scope and Non-Scope

### In scope

- Add FRP as a first-class tunnel provider for Paperweight-owned vanity URLs.
- Keep `https://<slug>.paperweighthq.com` as the public URL.
- Preserve current slug ownership model: station must register telemetry and own the slug before tunnel creation.
- Add a new System.Pape FRP provisioning endpoint that returns only station-scoped FRP client credentials/config, never gateway admin secrets.
- Add a Paperweight v1 FRP runtime resolver/supervisor equivalent to `src/runtime/cloudflared.js` and `src/runtime/tunnel-supervisor.js`.
- Update setup/provisioning, dashboard API, tests, and docs.
- Leave existing Cloudflare tunnel code in place as fallback until FRP is verified in production.

### Out of scope for this plan

- Building a fully dynamic multi-tenant FRP admin panel.
- Replacing creator-owned custom-domain Cloudflare flow immediately.
- Rewriting System.Pape public directory/search beyond the URL/tunnel metadata needed here.
- Shipping signed desktop builds.
- Migrating existing live users automatically without a deliberate ops runbook.

---

## Current Relevant Code

### Paperweight v1

- Existing Cloudflare binary resolver: `src/runtime/cloudflared.js`
- Existing Cloudflare process supervisor: `src/runtime/tunnel-supervisor.js`
- Existing Cloudflare REST client: `src/runtime/cloudflare.js`
- Existing dashboard route group: `src/api/dashboard.js:978-1324`
- Existing station config fields: `src/config.js:240-259`
- Existing boot auto-start: `src/index.js:475-480`
- Existing setup `.env` writer: `src/setup/provision.js:34-121`
- Existing PM2 tunnel sidecar: `ecosystem.config.js:16-47`
- Existing tests: `test/cloudflare.test.js`, `test/http.test.js`

### System.Pape

- Existing station/tunnel columns: `packages/db/src/schema/paperweight.ts:16-22`
- Existing Cloudflare tunnel migration: `packages/db/src/migrations/0007_paperweight_tunnels.sql`
- Existing public tunnel endpoint: `apps/web/src/modules/paperweight/router.ts:211-263`
- Existing Cloudflare tunnel service: `apps/web/src/modules/paperweight/service.ts:232-431`

---

## Target End State

A creator flow should be:

1. User installs Paperweight.
2. User picks/claims `STATION_SLUG=bud`.
3. User registers telemetry with System.Pape.
4. User clicks `Go public on paperweighthq.com`.
5. Paperweight calls System.Pape:

```http
POST /api/modules/paperweight/frp/tunnel/create
x-telemetry-secret: <station telemetry secret>
content-type: application/json

{
  "stationKey": "...",
  "slug": "bud"
}
```

6. System.Pape verifies slug ownership, issues scoped FRP config, and returns:

```json
{
  "ok": true,
  "provider": "frp",
  "hostname": "bud.paperweighthq.com",
  "serverAddr": "tunnel.paperweighthq.com",
  "serverPort": 7000,
  "authToken": "station-specific-secret",
  "proxyName": "pw-bud-<short-station-id>",
  "subdomain": "bud"
}
```

7. Paperweight persists these values to `.env`, starts `frpc`, and reports:

```text
Your station is live at https://bud.paperweighthq.com
```

---

## Task 1: Add Gateway Ops Documentation First

**Objective:** Document the FRP gateway shape before touching app code so implementation has a fixed contract.

**Files:**
- Create: `docs/frp-tunnel-gateway.md`
- Modify: `README.md` only if there is already a public URL/tunnel section that should link to the new doc.

**Step 1: Create `docs/frp-tunnel-gateway.md`**

Include this baseline:

```markdown
# Paperweight FRP Tunnel Gateway

Paperweight-owned vanity URLs use:

- DNS: `*.paperweighthq.com -> <gateway VPS IP>`
- FRP control: `tunnel.paperweighthq.com:7000`
- Public HTTPS: `https://<slug>.paperweighthq.com`
- TLS termination: Caddy/Traefik on the gateway
- Internal FRP HTTP vhost: `127.0.0.1:8080` or gateway-local equivalent

## DNS

```text
A tunnel.paperweighthq.com <VPS_IP>
A *.paperweighthq.com      <VPS_IP>
```

## `frps.toml`

```toml
bindPort = 7000
vhostHTTPPort = 8080
subDomainHost = "paperweighthq.com"

auth.method = "token"
auth.token = "${FRP_SERVER_TOKEN}"
```

## Station `frpc.toml` generated by Paperweight

```toml
serverAddr = "tunnel.paperweighthq.com"
serverPort = 7000

auth.method = "token"
auth.token = "${FRP_STATION_TOKEN}"

[[proxies]]
name = "pw-${SLUG}-${STATION_SHORT_ID}"
type = "http"
localIP = "127.0.0.1"
localPort = 3000
subdomain = "${SLUG}"
```

## Security Rules

- Stations never receive the FRP server admin token.
- Station tokens are unique per station.
- Reserved/admin slugs are blocked by System.Pape before config issuance.
- Only one stationKey can own a slug.
- Revocation means rotating the station token and/or blocking its proxy name at the gateway layer.
```

**Step 2: Verify docs render**

Run:

```bash
cd /home/bud/paperweightv1
node -e "const fs=require('fs'); const p='docs/frp-tunnel-gateway.md'; if(!fs.existsSync(p)) process.exit(1); console.log(fs.readFileSync(p,'utf8').split('\n')[0])"
```

Expected:

```text
# Paperweight FRP Tunnel Gateway
```

**Step 3: Commit**

```bash
git add docs/frp-tunnel-gateway.md README.md
git commit -m "docs: add frp tunnel gateway contract"
```

---

## Task 2: Add System.Pape FRP Tunnel Schema Fields

**Objective:** Store FRP tunnel metadata separately from existing Cloudflare tunnel metadata.

**Files:**
- Modify: `/home/bud/system.pape/packages/db/src/schema/paperweight.ts`
- Create: `/home/bud/system.pape/packages/db/src/migrations/0008_paperweight_frp_tunnels.sql`

**Step 1: Add schema columns**

In `pwStations`, add fields after current Cloudflare tunnel columns:

```ts
  frpProxyName: text('frp_proxy_name'),                 // e.g. pw-rolling-woods-a1b2c3
  frpSubdomain: text('frp_subdomain'),                 // slug routed by frps subDomainHost
  frpServerAddr: text('frp_server_addr'),              // e.g. tunnel.paperweighthq.com
  frpServerPort: integer('frp_server_port'),           // e.g. 7000
  frpAuthTokenHash: text('frp_auth_token_hash'),       // hash only; plaintext returned once to station
  frpHostname: text('frp_hostname'),                   // e.g. rolling-woods.paperweighthq.com
```

**Step 2: Add migration**

Create:

```sql
ALTER TABLE "pw_stations" ADD COLUMN "frp_proxy_name" text;
--> statement-breakpoint
ALTER TABLE "pw_stations" ADD COLUMN "frp_subdomain" text;
--> statement-breakpoint
ALTER TABLE "pw_stations" ADD COLUMN "frp_server_addr" text;
--> statement-breakpoint
ALTER TABLE "pw_stations" ADD COLUMN "frp_server_port" integer;
--> statement-breakpoint
ALTER TABLE "pw_stations" ADD COLUMN "frp_auth_token_hash" text;
--> statement-breakpoint
ALTER TABLE "pw_stations" ADD COLUMN "frp_hostname" text;
```

**Step 3: Typecheck System.Pape**

Run:

```bash
cd /home/bud/system.pape
pnpm -r typecheck
```

Expected: all packages pass.

**Step 4: Commit**

```bash
cd /home/bud/system.pape
git add packages/db/src/schema/paperweight.ts packages/db/src/migrations/0008_paperweight_frp_tunnels.sql
git commit -m "feat: add paperweight frp tunnel metadata"
```

---

## Task 3: Add System.Pape FRP Provisioning Service

**Objective:** Create a pure service function that verifies slug ownership and returns FRP client config.

**Files:**
- Modify: `/home/bud/system.pape/apps/web/src/modules/paperweight/service.ts`
- Test: use existing or new service test file if present; if none exists, create a small test near the module’s existing test convention.

**Step 1: Add environment constants**

Near existing tunnel constants:

```ts
const FRP_TUNNEL_DOMAIN = process.env.PAPERWEIGHT_FRP_TUNNEL_DOMAIN || 'paperweighthq.com'
const FRP_SERVER_ADDR = process.env.PAPERWEIGHT_FRP_SERVER_ADDR || 'tunnel.paperweighthq.com'
const FRP_SERVER_PORT = Number(process.env.PAPERWEIGHT_FRP_SERVER_PORT || 7000)
```

**Step 2: Add store methods**

Extend `TunnelStore` or create `FrpTunnelStore` with:

```ts
saveFrpTunnel(
  stationId: string,
  tunnel: {
    proxyName: string
    subdomain: string
    serverAddr: string
    serverPort: number
    authTokenHash: string
    hostname: string
  }
): Promise<void>
clearFrpTunnel(stationId: string): Promise<void>
```

**Step 3: Add result types**

```ts
export type FrpTunnelResult =
  | {
      ok: true
      provider: 'frp'
      hostname: string
      serverAddr: string
      serverPort: number
      authToken: string
      proxyName: string
      subdomain: string
    }
  | { ok: false; status: 409; error: string }
  | { ok: false; status: 502; error: string }
```

**Step 4: Add `createOrRotateFrpTunnel()`**

Implementation shape:

```ts
export async function createOrRotateFrpTunnel(
  payload: { stationKey: string; slug: string },
  deps: TunnelDeps = {}
): Promise<FrpTunnelResult> {
  const store = deps.store ?? defaultTunnelStore
  const station = await store.findBySlug(payload.slug)
  if (!ownsSlug(station, payload.stationKey)) {
    return { ok: false, status: 409, error: TUNNEL_SLUG_NOT_OWNED }
  }

  const slug = payload.slug.trim().toLowerCase()
  const authToken = crypto.randomBytes(32).toString('hex')
  const proxyName = `pw-${slug}-${station.id.slice(0, 8)}`.slice(0, 63)
  const hostname = `${slug}.${FRP_TUNNEL_DOMAIN}`

  await store.saveFrpTunnel(station.id, {
    proxyName,
    subdomain: slug,
    serverAddr: FRP_SERVER_ADDR,
    serverPort: FRP_SERVER_PORT,
    authTokenHash: hashSecret(authToken),
    hostname,
  })

  return {
    ok: true,
    provider: 'frp',
    hostname,
    serverAddr: FRP_SERVER_ADDR,
    serverPort: FRP_SERVER_PORT,
    authToken,
    proxyName,
    subdomain: slug,
  }
}
```

Important: if FRP token validation will initially be a single shared `frps` token, name this honestly as `serverToken` and do not pretend it is fully station-scoped. The better path is unique station tokens plus gateway/plugin enforcement; do not overstate security until that exists.

**Step 5: Add tests**

Test cases:

- Returns `409` when slug is unclaimed.
- Returns `409` when slug belongs to different stationKey.
- Returns config when slug belongs to stationKey.
- Generated token is returned once and only hash is stored.
- Hostname equals `<slug>.paperweighthq.com`.

**Step 6: Typecheck**

```bash
cd /home/bud/system.pape
pnpm -r typecheck
```

**Step 7: Commit**

```bash
git add apps/web/src/modules/paperweight/service.ts packages/db/src/schema/paperweight.ts
git commit -m "feat: add frp tunnel provisioning service"
```

---

## Task 4: Add System.Pape FRP API Endpoints

**Objective:** Expose station-authenticated FRP create/delete endpoints beside existing tunnel endpoints.

**Files:**
- Modify: `/home/bud/system.pape/apps/web/src/modules/paperweight/router.ts`
- Modify: `/home/bud/system.pape/apps/web/src/middleware.ts` if the new endpoints are not already covered by the public Paperweight route allowlist.

**Step 1: Import service functions**

Add:

```ts
  createOrRotateFrpTunnel,
  deleteFrpTunnel,
```

**Step 2: Add route**

Add after existing `/tunnel/create` route:

```ts
// POST /api/modules/paperweight/frp/tunnel/create
router.post('/frp/tunnel/create', async (c) => {
  const ip = getClientIp(c) ?? 'unknown'
  const rl = tunnelLimiter.check(ip)
  if (!rl.allowed) {
    return c.json({ error: 'too many tunnel requests' }, 429, {
      'Retry-After': String(rl.retryAfterSeconds),
    })
  }

  const parsed = await parseStationSlugBody(c)
  if ('error' in parsed) {
    return c.json({ error: parsed.error }, parsed.status)
  }

  if (!(await isIngestAuthorized(parsed.stationKey, c.req.header('x-telemetry-secret')))) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const result = await createOrRotateFrpTunnel(parsed)
  if (!result.ok) {
    return c.json({ error: result.error }, result.status)
  }

  return c.json(result)
})
```

**Step 3: Add delete/revoke route**

```ts
// DELETE /api/modules/paperweight/frp/tunnel
router.delete('/frp/tunnel', async (c) => {
  const parsed = await parseStationSlugBody(c)
  if ('error' in parsed) return c.json({ error: parsed.error }, parsed.status)

  if (!(await isIngestAuthorized(parsed.stationKey, c.req.header('x-telemetry-secret')))) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const result = await deleteFrpTunnel(parsed)
  if (!result.ok) return c.json({ error: result.error }, result.status)
  return c.json({ ok: true })
})
```

**Step 4: Verify middleware allowlist**

Check `apps/web/src/middleware.ts`. If `/api/modules/paperweight/` routes are already public for register/ingest/tunnel, add exact paths:

```ts
/api/modules/paperweight/frp/tunnel/create
/api/modules/paperweight/frp/tunnel
```

Do not open unrelated admin reads.

**Step 5: Verify**

```bash
cd /home/bud/system.pape
pnpm -r typecheck
pnpm build
```

Expected: both pass.

**Step 6: Commit**

```bash
git add apps/web/src/modules/paperweight/router.ts apps/web/src/middleware.ts apps/web/src/modules/paperweight/service.ts
git commit -m "feat: expose frp tunnel provisioning endpoint"
```

---

## Task 5: Add Paperweight v1 FRP Binary Resolver

**Objective:** Resolve `frpc` in source, pkg, and Electron contexts just like `cloudflared`.

**Files:**
- Create: `/home/bud/paperweightv1/src/runtime/frp.js`
- Create later if bundling: `/home/bud/paperweightv1/scripts/fetch-frp.js`
- Create later if pkg bundling: `/home/bud/paperweightv1/scripts/generate-frp-bundle.js`

**Step 1: Write tests first**

Add unit tests in a new file:

```js
// test/frp-runtime.test.js
process.env.PAPERWEIGHT_ALLOW_MISSING_ENV = 'true';

const test = require('node:test');
const assert = require('node:assert/strict');
const frp = require('../src/runtime/frp');

test('frp installHint returns platform-specific guidance', () => {
  assert.match(frp.installHint(), /frp|frpc|Paperweight/i);
});

test('frpcPath is a non-empty string', () => {
  assert.equal(typeof frp.frpcPath, 'string');
  assert.ok(frp.frpcPath.length > 0);
});
```

**Step 2: Run failing test**

```bash
cd /home/bud/paperweightv1
node --test test/frp-runtime.test.js
```

Expected: FAIL because `src/runtime/frp.js` does not exist.

**Step 3: Add resolver**

Create `src/runtime/frp.js`:

```js
'use strict';

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { ensureExtracted } = require('./bundle-extract');

const isPackaged = typeof process.pkg !== 'undefined';
const isElectron = process.env.PAPERWEIGHT_ELECTRON === 'true';
const FRPC_BIN = process.platform === 'win32' ? 'frpc.exe' : 'frpc';

let frpcPath = 'frpc';

if (isPackaged) {
  const dataRoot = path.dirname(process.execPath);
  const binDir = path.join(dataRoot, 'bin');
  const dest = path.join(binDir, FRPC_BIN);
  try {
    const bundle = require('../frp-bundle');
    const entry = bundle.frpc;
    if (!entry) throw new Error('frp-bundle.js is missing frpc');
    ensureExtracted(entry, dest);
  } catch (err) {
    console.warn(`[Paperweight] Could not extract bundled frpc: ${err.message}`);
  }
  if (fs.existsSync(dest)) frpcPath = dest;
} else if (isElectron && process.resourcesPath) {
  const electronDest = path.join(process.resourcesPath, 'bin', FRPC_BIN);
  if (fs.existsSync(electronDest)) frpcPath = electronDest;
  else {
    const vendorDest = path.join(__dirname, '../../vendor/frp', FRPC_BIN);
    if (fs.existsSync(vendorDest)) frpcPath = vendorDest;
  }
} else {
  const vendorDest = path.join(__dirname, '../../vendor/frp', FRPC_BIN);
  if (fs.existsSync(vendorDest)) frpcPath = vendorDest;
}

function commandVersion() {
  try {
    const result = spawnSync(frpcPath, ['--version'], {
      stdio: 'pipe',
      windowsHide: true,
      timeout: 3000,
      encoding: 'utf8',
    });
    if (result.status !== 0) return null;
    return String(result.stdout || result.stderr || '').split(/\r?\n/)[0] || `${frpcPath} found`;
  } catch {
    return null;
  }
}

function isAvailable() {
  return commandVersion() !== null;
}

function installHint() {
  if (isPackaged || isElectron) {
    return 'frpc could not be extracted from the Paperweight bundle. Try reinstalling Paperweight.';
  }
  return 'Install frp/frpc from https://github.com/fatedier/frp/releases or use a Paperweight desktop build that bundles it.';
}

module.exports = { frpcPath, commandVersion, isAvailable, installHint };
```

**Step 4: Run test**

```bash
node --test test/frp-runtime.test.js
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/runtime/frp.js test/frp-runtime.test.js
git commit -m "feat: resolve frp client runtime binary"
```

---

## Task 6: Add Paperweight v1 FRP Config Writer

**Objective:** Generate a safe per-station `frpc.toml` under the writable runtime root.

**Files:**
- Create: `/home/bud/paperweightv1/src/runtime/frp-config.js`
- Test: `/home/bud/paperweightv1/test/frp-config.test.js`

**Step 1: Write tests**

```js
process.env.PAPERWEIGHT_ALLOW_MISSING_ENV = 'true';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildFrpcToml, writeFrpcConfig } = require('../src/runtime/frp-config');

test('buildFrpcToml writes expected subdomain proxy config', () => {
  const toml = buildFrpcToml({
    serverAddr: 'tunnel.paperweighthq.com',
    serverPort: 7000,
    authToken: 'secret-token',
    proxyName: 'pw-bud-a1b2c3',
    subdomain: 'bud',
    localPort: 3000,
  });
  assert.match(toml, /serverAddr = "tunnel\.paperweighthq\.com"/);
  assert.match(toml, /serverPort = 7000/);
  assert.match(toml, /auth\.token = "secret-token"/);
  assert.match(toml, /subdomain = "bud"/);
  assert.match(toml, /localPort = 3000/);
});

test('writeFrpcConfig writes under runtime root with 0600 permissions when possible', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-frp-'));
  const out = writeFrpcConfig(root, {
    serverAddr: 'tunnel.paperweighthq.com',
    serverPort: 7000,
    authToken: 'secret-token',
    proxyName: 'pw-bud-a1b2c3',
    subdomain: 'bud',
    localPort: 3000,
  });
  assert.equal(path.dirname(out), path.join(root, 'tunnel'));
  assert.ok(fs.existsSync(out));
});
```

**Step 2: Run failing tests**

```bash
node --test test/frp-config.test.js
```

Expected: FAIL because module does not exist.

**Step 3: Implement module**

```js
'use strict';

const fs = require('fs');
const path = require('path');

function assertSafeTomlString(label, value) {
  const str = String(value || '').trim();
  if (!str || /[\r\n"#]/.test(str)) throw new Error(`${label} is invalid`);
  return str;
}

function buildFrpcToml({ serverAddr, serverPort, authToken, proxyName, subdomain, localPort }) {
  const cleanServerAddr = assertSafeTomlString('serverAddr', serverAddr);
  const cleanAuthToken = assertSafeTomlString('authToken', authToken);
  const cleanProxyName = assertSafeTomlString('proxyName', proxyName);
  const cleanSubdomain = assertSafeTomlString('subdomain', subdomain);
  const port = Number(serverPort);
  const local = Number(localPort);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error('serverPort is invalid');
  if (!Number.isInteger(local) || local <= 0 || local > 65535) throw new Error('localPort is invalid');

  return [
    `serverAddr = "${cleanServerAddr}"`,
    `serverPort = ${port}`,
    '',
    'auth.method = "token"',
    `auth.token = "${cleanAuthToken}"`,
    '',
    '[[proxies]]',
    `name = "${cleanProxyName}"`,
    'type = "http"',
    'localIP = "127.0.0.1"',
    `localPort = ${local}`,
    `subdomain = "${cleanSubdomain}"`,
    '',
  ].join('\n');
}

function writeFrpcConfig(root, opts) {
  const dir = path.join(root, 'tunnel');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'frpc.toml');
  fs.writeFileSync(file, buildFrpcToml(opts), { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch {}
  return file;
}

module.exports = { buildFrpcToml, writeFrpcConfig };
```

**Step 4: Verify**

```bash
node --test test/frp-config.test.js
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/runtime/frp-config.js test/frp-config.test.js
git commit -m "feat: write frp client configuration"
```

---

## Task 7: Add Paperweight v1 FRP Supervisor

**Objective:** Supervise `frpc -c <runtime-root>/tunnel/frpc.toml` with status/backoff semantics matching current Cloudflare supervisor.

**Files:**
- Create: `/home/bud/paperweightv1/src/runtime/frp-supervisor.js`
- Test: `/home/bud/paperweightv1/test/frp-supervisor.test.js`

**Step 1: Implement testable design**

Do not hard-code `spawn` directly in business logic. Export a factory for tests:

```js
function createFrpSupervisor({ spawnImpl = spawn, frpcPath: resolvedFrpcPath = frpcPath, logImpl = log } = {}) { ... }
```

Default export should be a singleton:

```js
const defaultSupervisor = createFrpSupervisor();
module.exports = { ...defaultSupervisor, createFrpSupervisor };
```

**Step 2: Supervisor behavior**

- `start(configPath)` validates non-empty config path.
- Stops previous process before starting new one.
- Spawns:

```js
spawn(frpcPath, ['-c', configPath], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
```

- Status values: `stopped`, `connecting`, `connected`, `error`.
- Detect connected logs with regex:

```js
/start proxy success|login to server success|work connection registered|proxy .* started/i
```

- Backoff same as current tunnel supervisor: max 5 attempts, 2s * attempt.
- `stop()` terminates child process.
- `getStatus()` returns `{ provider: 'frp', status, lastError, reconnectAttempts, running }`.

**Step 3: Tests**

Test cases:

- `start('x.toml')` spawns `frpc -c x.toml`.
- Connected log updates status.
- Child close sets `error` and schedules reconnect.
- `stop()` sets status stopped and does not schedule reconnect.

**Step 4: Verify**

```bash
node --test test/frp-supervisor.test.js
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/runtime/frp-supervisor.js test/frp-supervisor.test.js
git commit -m "feat: supervise frp tunnel client"
```

---

## Task 8: Extend Paperweight v1 Config and Setup Env

**Objective:** Add FRP env variables without breaking current Cloudflare env vars.

**Files:**
- Modify: `/home/bud/paperweightv1/src/config.js`
- Modify: `/home/bud/paperweightv1/src/setup/provision.js`
- Modify: `/home/bud/paperweightv1/.env.example` if present; otherwise setup docs.
- Test: existing `test/provision.test.js` plus new assertions.

**Step 1: Add config shape**

In `config.station`, add:

```js
    tunnelProvider: (process.env.PAPERWEIGHT_TUNNEL_PROVIDER || (process.env.FRP_TUNNEL_TOKEN ? 'frp' : process.env.CLOUDFLARE_TUNNEL_TOKEN ? 'cloudflare' : '')).trim(),
    frpTunnel: !!(process.env.FRP_TUNNEL_TOKEN && process.env.FRP_TUNNEL_TOKEN.trim()),
    frp: {
      serverAddr: (process.env.FRP_SERVER_ADDR || '').trim(),
      serverPort: parseInt(process.env.FRP_SERVER_PORT || '7000', 10),
      token: (process.env.FRP_TUNNEL_TOKEN || '').trim(),
      proxyName: (process.env.FRP_PROXY_NAME || '').trim(),
      subdomain: (process.env.FRP_SUBDOMAIN || '').trim(),
      configPath: (process.env.FRP_CONFIG_PATH || '').trim(),
    },
```

Keep `cloudflareTunnel` for compatibility.

**Step 2: Add setup `.env` defaults**

In `buildEnv()`, after Cloudflare values:

```js
    'PAPERWEIGHT_TUNNEL_PROVIDER=',
    'FRP_SERVER_ADDR=',
    'FRP_SERVER_PORT=7000',
    'FRP_TUNNEL_TOKEN=',
    'FRP_PROXY_NAME=',
    'FRP_SUBDOMAIN=',
    'FRP_CONFIG_PATH=',
```

**Step 3: Update tests**

In `test/provision.test.js`, assert generated `.env` includes FRP keys.

**Step 4: Verify**

```bash
npm test -- --test-name-pattern="provision|config|frp"
```

If the test runner does not support name pattern, run:

```bash
node --test test/provision.test.js test/frp-config.test.js test/frp-runtime.test.js
```

**Step 5: Commit**

```bash
git add src/config.js src/setup/provision.js test/provision.test.js .env.example
git commit -m "feat: add frp tunnel environment config"
```

---

## Task 9: Add Paperweight v1 FRP Dashboard API Route

**Objective:** Let the station request a Paperweight-owned FRP vanity URL through System.Pape.

**Files:**
- Modify: `/home/bud/paperweightv1/src/api/dashboard.js`
- Test: `/home/bud/paperweightv1/test/http.test.js`

**Step 1: Import FRP helpers**

At the top of `src/api/dashboard.js`:

```js
const frpSupervisor = require('../runtime/frp-supervisor');
const { writeFrpcConfig } = require('../runtime/frp-config');
```

**Step 2: Add route**

Add near existing `paperweighthq/create` route:

```js
// POST /api/dashboard/station/frp/paperweighthq/create
router.post('/station/frp/paperweighthq/create', requireDesktop, asyncHandler(async (req, res) => {
  if (!config.station.slug) {
    return res.status(409).json({ error: 'Claim a station slug first' });
  }
  if (!config.telemetry.secretConfigured) {
    return res.status(409).json({ error: 'Register with system.pape telemetry first' });
  }

  const stationKey = telemetryReporter.getStationKey();
  let response;
  try {
    response = await fetch(new NodeURL('/api/modules/paperweight/frp/tunnel/create', config.telemetry.url), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-telemetry-secret': process.env.PAPE_TELEMETRY_SECRET },
      body: JSON.stringify({ slug: config.station.slug, stationKey }),
    });
  } catch (err) {
    return res.status(502).json({ error: `Could not reach system.pape: ${err.message}` });
  }

  if (response.status === 409) {
    const body = await response.json().catch(() => ({}));
    return res.status(409).json({ error: body.error || 'Slug not claimed by this station' });
  }
  if (!response.ok) {
    return res.status(502).json({ error: `system.pape FRP tunnel creation failed (HTTP ${response.status})` });
  }

  const body = await response.json().catch(() => ({}));
  for (const key of ['hostname', 'serverAddr', 'serverPort', 'authToken', 'proxyName', 'subdomain']) {
    if (!body[key]) return res.status(502).json({ error: 'system.pape returned an unexpected FRP response' });
  }

  const configPath = writeFrpcConfig(config.paths.root, {
    serverAddr: body.serverAddr,
    serverPort: body.serverPort,
    authToken: body.authToken,
    proxyName: body.proxyName,
    subdomain: body.subdomain,
    localPort: config.port,
  });
  const publicUrl = `https://${body.hostname}`;

  updateEnvKey('PAPERWEIGHT_TUNNEL_PROVIDER', 'frp');
  updateEnvKey('FRP_SERVER_ADDR', body.serverAddr);
  updateEnvKey('FRP_SERVER_PORT', body.serverPort);
  updateEnvKey('FRP_TUNNEL_TOKEN', body.authToken);
  updateEnvKey('FRP_PROXY_NAME', body.proxyName);
  updateEnvKey('FRP_SUBDOMAIN', body.subdomain);
  updateEnvKey('FRP_CONFIG_PATH', configPath);
  updateEnvKey('STATION_PUBLIC_URL', publicUrl);
  updateEnvKey('HTTPS', 'true');
  updateEnvKey('TRUST_PROXY', 'loopback');

  config.station.tunnelProvider = 'frp';
  config.station.publicUrl = publicUrl;
  config.station.frpTunnel = true;
  config.station.frp = { serverAddr: body.serverAddr, serverPort: body.serverPort, token: body.authToken, proxyName: body.proxyName, subdomain: body.subdomain, configPath };

  const db = getDb();
  const existing = db.prepare('SELECT id FROM station_registry WHERE id = 1').get();
  if (existing) {
    db.prepare("UPDATE station_registry SET url = ?, updated_at = datetime('now') WHERE id = 1").run(publicUrl);
  }

  log('info', 'dashboard', `FRP tunnel created for ${body.hostname}`);
  frpSupervisor.start(configPath);

  res.json({
    ok: true,
    provider: 'frp',
    url: publicUrl,
    restartRequired: false,
    tunnelStatus: frpSupervisor.getStatus(),
  });
}));
```

**Step 3: Add HTTP tests**

Mirror the existing `/api/modules/paperweight/tunnel/create` fake System.Pape test in `test/http.test.js`. Add cases:

- 409 if no slug.
- 409 if telemetry not registered.
- Calls `/api/modules/paperweight/frp/tunnel/create` with `x-telemetry-secret`.
- Persists `FRP_*` values to `.env`.
- Updates `station_registry.url` to `https://<slug>.paperweighthq.com`.

**Step 4: Verify**

```bash
node --test test/http.test.js test/frp-config.test.js test/frp-supervisor.test.js
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/api/dashboard.js test/http.test.js
git commit -m "feat: request and start frp paperweighthq tunnel"
```

---

## Task 10: Start FRP on Boot and Stop on Shutdown

**Objective:** Resume FRP tunnels across app restarts the same way Cloudflare currently resumes.

**Files:**
- Modify: `/home/bud/paperweightv1/src/index.js`
- Modify: `/home/bud/paperweightv1/ecosystem.config.js`

**Step 1: Import FRP supervisor**

In `src/index.js` near `tunnelSupervisor` import:

```js
const frpSupervisor = require('./runtime/frp-supervisor');
```

**Step 2: Start on boot**

After Cloudflare start block:

```js
  if (config.station.frpTunnel && config.station.frp && config.station.frp.configPath) {
    frpSupervisor.start(config.station.frp.configPath);
  }
```

Avoid starting both providers if `PAPERWEIGHT_TUNNEL_PROVIDER` is set. If both tokens exist, prefer explicit provider:

```js
const provider = config.station.tunnelProvider;
if (provider === 'frp') start frp;
else if (provider === 'cloudflare') start cloudflared;
else preserve old cloudflare behavior for compatibility;
```

**Step 3: Stop on shutdown**

Add:

```js
frpSupervisor.stop();
```

beside `tunnelSupervisor.stop()`.

**Step 4: PM2 sidecar**

Update `ecosystem.config.js` to load `PAPERWEIGHT_TUNNEL_PROVIDER`, `FRP_CONFIG_PATH`, and add a `frpc-tunnel` app only if provider is `frp` and config path exists. Alternatively, choose one supervision model only. Recommended: app-internal child process for desktop/source; PM2 sidecar only for legacy headless deployments.

**Step 5: Verify**

Add/adjust tests if startup/shutdown tests exist. At minimum run:

```bash
npm test
```

Expected: all tests pass.

**Step 6: Commit**

```bash
git add src/index.js ecosystem.config.js
git commit -m "feat: resume frp tunnels on startup"
```

---

## Task 11: Update Dashboard Frontend Controls

**Objective:** Let creators use FRP from the station dashboard without exposing infrastructure terms too early.

**Files:**
- Modify: `/home/bud/paperweightv1/client/js/api.js`
- Modify: `/home/bud/paperweightv1/client/js/dashboard/station.js`
- Modify: `/home/bud/paperweightv1/client/js/dashboard/desktop-controls.js` if tunnel power controls are provider-specific.
- Run generator: `/home/bud/paperweightv1/scripts/generate-client-bundle.js`

**Step 1: Add API client method**

In `client/js/api.js` station dashboard API:

```js
createFrpPaperweighthqTunnel() {
  return _send('/api/dashboard/station/frp/paperweighthq/create', {}, 'POST');
},
```

**Step 2: Update button label/copy**

In `client/js/dashboard/station.js`, keep the user copy simple:

```text
Go public at <slug>.paperweighthq.com
```

Under the hood call FRP first. Keep Cloudflare owner-domain flow as an advanced/custom-domain option.

**Step 3: Update status copy**

Tunnel status should show provider when known:

```text
Tunnel provider: Paperweight Gateway
Status: connected
```

Avoid saying “Cloudflare” for FRP-backed vanity URLs.

**Step 4: Regenerate client bundle**

```bash
cd /home/bud/paperweightv1
node scripts/generate-client-bundle.js
npm run check:package
```

Expected: bundle generated and package check passes.

**Step 5: Run tests**

```bash
npm test
```

**Step 6: Commit**

```bash
git add client/js/api.js client/js/dashboard/station.js client/js/dashboard/desktop-controls.js src/client-bundle.js
git commit -m "feat: add frp vanity tunnel dashboard flow"
```

---

## Task 12: Bundle FRP for Desktop/Electron

**Objective:** Include `frpc` in desktop/package builds the same way `cloudflared` is currently included.

**Files:**
- Create: `/home/bud/paperweightv1/scripts/fetch-frp.js`
- Create: `/home/bud/paperweightv1/scripts/generate-frp-bundle.js`
- Modify: `/home/bud/paperweightv1/scripts/build-desktop-runtime.js`
- Modify: `/home/bud/paperweightv1/electron/package.json` or root `package.json` scripts as needed.
- Modify: `/home/bud/paperweightv1/scripts/check-desktop-artifact.js`
- Modify: `/home/bud/paperweightv1/scripts/check-package-assets.js`

**Step 1: Mirror Cloudflare scripts**

Use existing scripts as templates:

- `scripts/fetch-cloudflared.js`
- `scripts/generate-cloudflared-bundle.js`
- `scripts/stage-electron-cloudflared.js`

Create FRP equivalents that download FRP release artifacts for supported platforms and extract only `frpc`.

**Step 2: Add package scripts**

Root `package.json`:

```json
{
  "scripts": {
    "fetch-frp": "node scripts/fetch-frp.js",
    "generate-frp-bundle": "node scripts/generate-frp-bundle.js"
  }
}
```

**Step 3: Stage Electron binary**

Update desktop staging so the built app contains:

```text
resources/bin/frpc[.exe]
```

**Step 4: Add artifact checks**

`check-desktop-artifact.js` should fail if FRP provider is now release-critical and the desktop artifact lacks `frpc`.

**Step 5: Verify**

```bash
npm run fetch-frp
npm run generate-frp-bundle
npm run check:package
cd electron && npm run dist:linux
cd .. && npm run check:desktop-artifact
```

If cross-platform packaging is unavailable on the current host, document that only Linux artifact was verified locally.

**Step 6: Commit**

```bash
git add scripts/fetch-frp.js scripts/generate-frp-bundle.js scripts/build-desktop-runtime.js scripts/check-desktop-artifact.js scripts/check-package-assets.js package.json electron/package.json src/frp-bundle.js vendor/frp
git commit -m "build: bundle frp client for desktop releases"
```

---

## Task 13: Add Gateway Integration Smoke Test Script

**Objective:** Provide a real ops-level verification path against staging gateway without relying only on unit tests.

**Files:**
- Create: `/home/bud/paperweightv1/scripts/smoke-frp-tunnel.js`
- Modify: `/home/bud/paperweightv1/package.json`

**Step 1: Script behavior**

Script inputs:

```bash
FRP_TEST_URL=https://testslug.paperweighthq.com \
FRP_TEST_EXPECT=Paperweight \
npm run smoke:frp
```

The script should:

1. Fetch `${FRP_TEST_URL}/api/health`.
2. Require HTTP 200.
3. Optionally verify body contains expected content.
4. Print clear PASS/FAIL.

**Step 2: Add package script**

```json
"smoke:frp": "node scripts/smoke-frp-tunnel.js"
```

**Step 3: Verify against local fake server first**

Run Paperweight locally, map FRP manually, then:

```bash
FRP_TEST_URL=https://<test-slug>.paperweighthq.com npm run smoke:frp
```

**Step 4: Commit**

```bash
git add scripts/smoke-frp-tunnel.js package.json
git commit -m "test: add frp tunnel smoke check"
```

---

## Task 14: Production Gateway Deployment Runbook

**Objective:** Make the VPS side repeatable and not tribal knowledge.

**Files:**
- Create: `/home/bud/paperweightv1/docs/frp-gateway-runbook.md`

**Content requirements:**

- VPS sizing recommendation: 1 vCPU / 1GB RAM is enough for MVP unless bandwidth spikes.
- Firewall ports:

```text
80/tcp
443/tcp
7000/tcp
```

- DNS records.
- `frps.toml` path and permissions.
- Caddy/Traefik config.
- systemd units:

```ini
[Unit]
Description=Paperweight FRP server
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=/usr/local/bin/frps -c /etc/paperweight/frps.toml
Restart=always
RestartSec=5
User=frp
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=true

[Install]
WantedBy=multi-user.target
```

- Verification commands:

```bash
systemctl status paperweight-frps
ss -ltnp | grep -E ':7000|:80|:443'
curl -I https://tunnel.paperweighthq.com
curl -I https://test.paperweighthq.com
```

- Rollback: keep Cloudflare route enabled until FRP smoke passes.

**Verify:**

```bash
node -e "const fs=require('fs'); console.log(fs.existsSync('docs/frp-gateway-runbook.md'))"
```

Expected: `true`.

**Commit:**

```bash
git add docs/frp-gateway-runbook.md
git commit -m "docs: add frp gateway deployment runbook"
```

---

## Task 15: Full Verification Gate

**Objective:** Prove the implementation is safe before calling it done.

**Files:**
- No new files unless fixing test failures.

**Step 1: Paperweight v1 checks**

```bash
cd /home/bud/paperweightv1
npm test
npm run check:package
npm run preflight
```

Expected:

- Unit/HTTP tests pass.
- Package bundle is current.
- Preflight has no new FRP-related FAIL items; if `frpc` is optional in source mode, warn not fail.

**Step 2: System.Pape checks**

```bash
cd /home/bud/system.pape
pnpm -r typecheck
pnpm build
```

Expected: both pass.

**Step 3: Manual staging flow**

Against staging System.Pape/gateway:

1. Start Paperweight with isolated runtime paths.
2. Register telemetry.
3. Create FRP tunnel.
4. Confirm `.env` contains `PAPERWEIGHT_TUNNEL_PROVIDER=frp` and `FRP_*` keys.
5. Confirm `tunnel/frpc.toml` exists and does not leak in logs/UI.
6. Visit:

```text
https://<test-slug>.paperweighthq.com/api/health
```

7. Confirm public player loads.
8. Stop Paperweight and confirm public URL fails/returns gateway error.
9. Restart Paperweight and confirm supervisor reconnects.

**Step 4: Commit verification fixes only**

```bash
git status --short
# commit only deliberate fixes, never random generated/runtime files
```

---

## Rollout Strategy

### Phase A: Parallel hidden FRP support

- Implement FRP backend and Paperweight route.
- Keep frontend pointing to current Cloudflare flow unless `PAPERWEIGHT_ENABLE_FRP_TUNNELS=true` or equivalent feature flag is set.

### Phase B: Internal staging

- Use a test slug like `frp-test.paperweighthq.com`.
- Test source mode and Electron mode.
- Validate System.Pape telemetry/directory still sees correct `publicUrl`.

### Phase C: Default Paperweight-owned vanity URLs to FRP

- Dashboard `Go public on paperweighthq.com` calls FRP route.
- Existing creator-owned custom-domain Cloudflare flow remains under Advanced.

### Phase D: Decommission Cloudflare Paperweight-owned tunnel path

- Only after multiple real stations stay stable for a week.
- Keep Cloudflare code as fallback until the next release cycle.

---

## Risk Register

### Risk: FRP token is global, not station-scoped

If `frps` only accepts one global `auth.token`, every station connector effectively has the same gateway credential. That is unacceptable long term.

**Mitigation:** MVP may use this only in private testing. Production needs either:

- FRP server plugin/auth hook that verifies proxyName/subdomain/token against System.Pape, or
- isolated FRP server per cohort, or
- another tunnel layer with native per-client auth.

### Risk: User can claim someone else’s subdomain

**Mitigation:** System.Pape must only issue `subdomain = slug` after existing stationKey/slug ownership passes.

### Risk: Local app binds wrong port

Paperweight currently auto-increments ports if configured port is busy. FRP config must use actual `config.port` after binding, not stale `.env PORT`, or tunnel points at the wrong local port.

**Mitigation:** only generate/start FRP after server bind or restart FRP after port changes.

### Risk: HTTPS cookie behavior

Paperweight currently sets `HTTPS=true` when public URL is HTTPS. Confirm secure cookies work behind FRP/Caddy and `TRUST_PROXY=loopback` is sufficient.

### Risk: Gateway TLS wildcard issuance

Wildcard certs require DNS-01 challenge. HTTP-01 will not issue a wildcard certificate.

**Mitigation:** use DNS provider integration in Caddy/Traefik and document required DNS token.

### Risk: Desktop packaging misses `frpc`

**Mitigation:** artifact check fails if `resources/bin/frpc` is absent once FRP is release-critical.

---

## Acceptance Criteria

- [ ] `system.pape` has FRP tunnel metadata columns and migration.
- [ ] `system.pape` exposes `POST /api/modules/paperweight/frp/tunnel/create`.
- [ ] Endpoint requires valid per-station telemetry secret.
- [ ] Endpoint refuses unowned/taken slugs with `409`.
- [ ] Endpoint returns FRP client config for owned slug.
- [ ] Paperweight v1 persists `PAPERWEIGHT_TUNNEL_PROVIDER=frp`, `FRP_*`, and `STATION_PUBLIC_URL`.
- [ ] Paperweight v1 writes a safe `tunnel/frpc.toml` under runtime root.
- [ ] Paperweight v1 supervises `frpc` and reconnects on failure.
- [ ] Paperweight v1 starts FRP tunnel on restart.
- [ ] Dashboard uses user-facing copy: `Go public at <slug>.paperweighthq.com`.
- [ ] `npm test` passes in `/home/bud/paperweightv1`.
- [ ] `npm run check:package` passes after frontend changes.
- [ ] `pnpm -r typecheck` and `pnpm build` pass in `/home/bud/system.pape`.
- [ ] Staging URL `https://<test-slug>.paperweighthq.com/api/health` returns 200 through FRP.

---

## Suggested Commit Sequence

```bash
# paperweightv1
feat: add frp tunnel gateway docs
feat: resolve frp client runtime binary
feat: write frp client configuration
feat: supervise frp tunnel client
feat: add frp tunnel environment config
feat: request and start frp paperweighthq tunnel
feat: resume frp tunnels on startup
feat: add frp vanity tunnel dashboard flow
build: bundle frp client for desktop releases
test: add frp tunnel smoke check
docs: add frp gateway deployment runbook

# system.pape
feat: add paperweight frp tunnel metadata
feat: add frp tunnel provisioning service
feat: expose frp tunnel provisioning endpoint
```

---

## Implementation Notes for Future Hermes/Subagents

- Check `git status --short --branch` in both repos before editing.
- Preserve unrelated dirty work, especially Paperweight icon assets if present.
- Do not read or print real `.env` secrets unless absolutely required, and never include them in final output.
- Keep current Cloudflare flow intact during FRP work; this is a migration, not a rip-and-replace.
- Avoid logging FRP tokens, generated `frpc.toml`, or telemetry secrets.
- Prefer tests that use fake System.Pape/FRP processes over real network for unit tests.
- Real FRP gateway verification belongs in smoke/manual staging, not normal unit tests.
