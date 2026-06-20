# Installer UX + Email Capture Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Improve the Paperweight installer/download UX by keeping Windows and macOS selection inline, adding focused secondary modals only for help/legal/email-update flows, keeping email required for download access records, and making “send me important release/setup updates” a separate optional consent.

**Architecture:** Keep platform selection and installer instructions on the download page as inline selectable panels/cards. Add small reusable modal components only for secondary flows: Windows SmartScreen help, macOS Gatekeeper help, and email/update confirmation. Reuse the existing `/api/download-lead` endpoint and `download_leads` table; do not change landing/download routing, public URLs, release asset URLs, or other unrelated page issues in this plan.

**Tech Stack:** Vanilla HTML/CSS/JS in `landing/download.html`, Express route `src/api/download-lead.js`, SQLite via existing migrations, Node test runner.

**Explicit Non-Goals:**
- Do not fix `/download` vs `/landing/download` routing in this plan.
- Do not change `landing/index.html` links in this plan.
- Do not replace Discord placeholder download URLs in this plan.
- Do not change release packaging/build scripts in this plan.
- Do not convert platform selection into a primary modal.

---

## Current State

Relevant existing files:

- `landing/download.html`
  - Inline platform selector exists.
  - Legal/content checkboxes exist.
  - Email input exists.
  - Download button is gated until both checkboxes and a valid email are present.
  - Submit calls `POST /api/download-lead` with `{ email, platform }`.

- `src/api/download-lead.js`
  - Public endpoint exists.
  - Validates email only by checking for `@`.
  - Inserts `{ email, platform }` into `download_leads`.
  - Does not yet record whether the user explicitly opted into important release/setup updates.

- `src/db/migrations/index.js`
  - `015_download_leads.sql` migration already creates `download_leads`.
  - Allows duplicates so each download event is recorded.

- `src/api/dashboard.js`
  - `GET /api/dashboard/download-leads` already returns captured emails.

This plan improves the UX and capture semantics without changing unrelated routing/download-link problems.

---

## Desired UX

Primary flow remains inline:

1. User lands on download page.
2. OS is detected and matching platform panel is selected.
3. User can switch Windows/macOS/Linux/Pi inline.
4. Selected platform panel shows:
   - platform name
   - architecture
   - short run/start instructions
   - secondary help button when relevant
6. User must enter a valid email before download.
7. User can optionally check **“Send me important release/setup updates”**.
8. Legal/content acknowledgement remains required before download.
9. When user clicks download:
   - always save the email/platform lead before opening the download link.
   - include an `updatesOptIn` flag so the backend can distinguish required email capture from explicit update permission.
10. Show a lightweight confirmation/status message after capture:
   - If opted in: “Updates enabled for bud@example.com.”
   - If not opted in: “Email saved for this download.”
   - Do not block the download if the capture request fails.

Secondary modal use only:

- `Windows help` modal: SmartScreen/firewall/admin note.
- `macOS help` modal: Gatekeeper/right-click-open note.
- `Email updates` confirmation/status modal or inline toast.

---

## Task 1: Add HTTP tests for required email capture and optional updates consent

**Objective:** Lock in the intended server behavior before changing frontend semantics.

**Files:**
- Modify: `test/http.test.js`
- Existing route under test: `src/api/download-lead.js`

**Step 1: Add tests near existing HTTP API tests**

Add tests that verify:

1. Valid lead POST stores lowercased, trimmed email, platform, and `updates_opt_in = 1` when consent is checked.
2. Valid lead POST stores `updates_opt_in = 0` when consent is not checked.
3. Invalid email returns `400`.
4. Platform is normalized/accepted only from known platform keys if Task 2 adds platform validation.

Example test shape:

```js
test('download lead capture stores normalized email and selected platform', async () => {
  const db = freshDb();
  await withServer(async baseUrl => {
    const result = await request(baseUrl, '/api/download-lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: '  Bud@Example.COM  ', platform: 'mac-arm64', updatesOptIn: true }),
    });

    assert.equal(result.res.status, 200);
    assert.equal(result.body.ok, true);

    const row = db.prepare('SELECT email, platform, updates_opt_in FROM download_leads ORDER BY id DESC LIMIT 1').get();
    assert.deepEqual(row, { email: 'bud@example.com', platform: 'mac-arm64', updates_opt_in: 1 });
  });
});

test('download lead capture rejects invalid email', async () => {
  freshDb();
  await withServer(async baseUrl => {
    const result = await request(baseUrl, '/api/download-lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email', platform: 'win' }),
    });

    assert.equal(result.res.status, 400);
    assert.match(result.body.error, /email/i);
  });
});
```

**Step 2: Run tests to verify current behavior**

Run:

```bash
node --test test/http.test.js
```

Expected:

- Valid storage test probably passes.
- Invalid email test may fail for weak validation depending on input.

**Step 3: Commit after green or after adding expected failing tests**

```bash
git add test/http.test.js
git commit -m "test: cover download lead capture"
```

---

## Task 2: Add updates opt-in storage to download leads

**Objective:** Persist whether the required email capture also has explicit permission for important release/setup updates.

**Files:**
- Modify: `src/db/migrations/index.js`
- Modify: `src/api/dashboard.js`
- Modify if needed: `scripts/check-migrations.js`
- Test: `test/http.test.js`

**Step 1: Add a new migration entry after the current latest migration**

Do not edit migration `015_download_leads.sql` in-place for existing installs. Add a new migration, for example `016_download_lead_updates_opt_in.sql`:

```js
{
  filename: "016_download_lead_updates_opt_in.sql",
  sql: `-- Migration 016: Track explicit update permission for download leads

ALTER TABLE download_leads ADD COLUMN updates_opt_in INTEGER NOT NULL DEFAULT 0;
`,
},
```

If this project’s migration runner cannot safely run `ALTER TABLE ... ADD COLUMN` when the column already exists, keep it as a one-time migration only; do not add recurring guarded ALTER logic unless tests prove fresh DBs or old DBs fail.

**Step 2: Update migration checks if they assert table columns**

If `scripts/check-migrations.js` only checks the table exists, add a check that `download_leads.updates_opt_in` exists.

Example check:

```js
const downloadLeadColumns = db.prepare('PRAGMA table_info(download_leads)').all().map(row => row.name);
assert(downloadLeadColumns.includes('updates_opt_in'), 'download_leads.updates_opt_in missing');
```

Adapt to the script’s existing assertion style.

**Step 3: Include update consent in the dashboard lead export**

Update `src/api/dashboard.js` so `GET /api/dashboard/download-leads` returns the consent flag:

```js
const rows = getDb().prepare(
  'SELECT id, email, platform, updates_opt_in AS updatesOptIn, created_at FROM download_leads ORDER BY created_at DESC'
).all();
```

**Step 4: Run migration check**

```bash
npm run check:migrations
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/db/migrations/index.js src/api/dashboard.js scripts/check-migrations.js test/http.test.js
git commit -m "feat: track download update opt-in"
```

---

## Task 3: Harden download lead validation without adding new dependencies

**Objective:** Make the public email capture endpoint safe and predictable.

**Files:**
- Modify: `src/api/download-lead.js`
- Test: `test/http.test.js`

**Step 1: Add small validation helpers**

Use local constants, no dependency:

```js
const VALID_PLATFORMS = new Set(['win', 'mac-arm64', 'mac-x64', 'linux-x64', 'linux-arm64']);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizePlatform(value) {
  const key = String(value || '').trim().toLowerCase();
  return VALID_PLATFORMS.has(key) ? key : null;
}
```

**Step 2: Update route implementation**

```js
router.post('/', authLimiter, (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const platform = normalizePlatform(req.body?.platform);
  const updatesOptIn = req.body?.updatesOptIn === true ? 1 : 0;

  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'Valid email is required' });
  }

  getDb().prepare(
    'INSERT INTO download_leads (email, platform, updates_opt_in) VALUES (?, ?, ?)'
  ).run(email, platform, updatesOptIn);

  res.json({ ok: true });
});
```

**Step 3: Export helpers only if tests need direct unit coverage**

Prefer endpoint-level tests. Only export helpers if validation becomes hard to test through HTTP.

**Step 4: Run focused tests**

```bash
node --test test/http.test.js
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/api/download-lead.js test/http.test.js
git commit -m "fix: validate download lead submissions"
```

---

## Task 4: Keep email required, make update permission optional

**Objective:** Keep email capture required before download, but separate it from the optional “send me important release/setup updates” permission.

**Files:**
- Modify: `landing/download.html`

**Step 1: Replace the current email input copy**

Current email block should clearly communicate that email is required for the download, while updates are optional:

```html
<div class="dl-gate-email-wrap">
  <input type="email" id="gate-email" class="dl-gate-email" placeholder="your@email.com (required)">
  <div class="dl-gate-disclaimer">Required for access records and critical release notices. We never sell or share your data.</div>
</div>
<label class="dl-gate-check dl-updates-check">
  <input type="checkbox" id="gate-chk-updates">
  Send me important release/setup updates for Paperweight.
</label>
<div class="dl-gate-status" id="gate-status" role="status" aria-live="polite"></div>
```

**Step 2: Update CSS for the status message**

Add near existing `.dl-gate-disclaimer` styles:

```css
.dl-gate-status{
  min-height:16px;
  font-family:var(--mono);
  font-size:10px;
  color:rgba(57,255,20,.65);
  letter-spacing:.03em;
}
.dl-gate-status.error{color:rgba(255,120,120,.75)}
```

**Step 3: Update gate logic**

Replace current `updateGate()` so legal acceptance and a valid email are required. The updates checkbox does not affect whether download is enabled:

```js
function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((value || '').trim());
}

function updateGate() {
  const legalOk = document.getElementById('gate-chk-license').checked &&
                  document.getElementById('gate-chk-content').checked;
  const email = document.getElementById('gate-email').value || '';
  const emailOk = validEmail(email);

  document.getElementById('dl-btn').classList.toggle('gated', !(legalOk && emailOk));
}
```

**Step 4: Update event listeners**

```js
document.getElementById('gate-chk-license').addEventListener('change', updateGate);
document.getElementById('gate-chk-content').addEventListener('change', updateGate);
document.getElementById('gate-chk-updates').addEventListener('change', updateGate);
document.getElementById('gate-email').addEventListener('input', updateGate);
```

**Step 5: Run static parse check**

```bash
node -e "const fs=require('fs'); const html=fs.readFileSync('landing/download.html','utf8'); const js=html.match(/<script>([\s\S]*)<\/script>/)[1]; new Function(js); console.log('download page JS parses')"
```

Expected:

```text
download page JS parses
```

**Step 6: Commit**

```bash
git add landing/download.html
git commit -m "feat: make download updates opt-in optional"
```

---

## Task 5: Make download click capture required email non-blocking for navigation

**Objective:** Save every download email/platform lead, include optional update consent, but never block the actual download because capture failed.

**Files:**
- Modify: `landing/download.html`

**Step 1: Replace current download click listener**

Use this behavior:

```js
document.getElementById('dl-btn').addEventListener('click', function(e) {
  if (this.classList.contains('gated')) return;

  e.preventDefault();

  const href = this.href;
  const updatesOptIn = document.getElementById('gate-chk-updates').checked;
  const email = (document.getElementById('gate-email').value || '').trim();
  const status = document.getElementById('gate-status');

  function openDownload() {
    window.open(href, '_blank', 'noopener,noreferrer');
  }

  status.classList.remove('error');
  status.textContent = updatesOptIn ? 'Saving update preference…' : 'Saving email…';

  fetch('/api/download-lead', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, platform: activePlatform, updatesOptIn }),
  })
    .then(res => {
      if (!res.ok) throw new Error('capture failed');
      status.textContent = updatesOptIn
        ? `Updates enabled for ${email}.`
        : 'Email saved for this download.';
    })
    .catch(() => {
      status.classList.add('error');
      status.textContent = 'Could not save email, but your download will still open.';
    })
    .finally(openDownload);
});
```

**Step 2: Verify JS parses**

```bash
node -e "const fs=require('fs'); const html=fs.readFileSync('landing/download.html','utf8'); const js=html.match(/<script>([\s\S]*)<\/script>/)[1]; new Function(js); console.log('download page JS parses')"
```

Expected: PASS.

**Step 3: Commit**

```bash
git add landing/download.html
git commit -m "feat: capture download updates without blocking downloads"
```

---

## Task 6: Add secondary help modals for Windows and macOS only

**Objective:** Use modals only for contextual installer friction, not for the primary platform selection.

**Files:**
- Modify: `landing/download.html`

**Step 1: Add modal markup near the top of `<body>`**

```html
<div class="dl-help-backdrop" id="dl-help-backdrop" hidden>
  <div class="dl-help-modal" role="dialog" aria-modal="true" aria-labelledby="dl-help-title">
    <button class="dl-help-close" id="dl-help-close" aria-label="Close help">×</button>
    <div class="dl-help-kicker" id="dl-help-kicker">Installer Help</div>
    <h2 class="dl-help-title" id="dl-help-title"></h2>
    <div class="dl-help-body" id="dl-help-body"></div>
  </div>
</div>
```

**Step 2: Add modal CSS**

Keep it visually consistent and small:

```css
.dl-help-backdrop{
  position:fixed;inset:0;z-index:500;
  display:flex;align-items:center;justify-content:center;
  padding:24px;
  background:rgba(0,0,0,.72);
  -webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);
}
.dl-help-modal{
  width:min(440px,100%);
  background:linear-gradient(160deg,#161616,#0d0d0d);
  border:1px solid var(--border-hi);
  border-radius:16px;
  box-shadow:0 32px 80px rgba(0,0,0,.8),0 0 40px rgba(57,255,20,.08);
  padding:24px;
  position:relative;
}
.dl-help-close{
  position:absolute;top:12px;right:14px;
  color:var(--t-muted);font-size:24px;
}
.dl-help-close:hover{color:var(--text)}
.dl-help-kicker{
  font-family:var(--mono);font-size:10px;letter-spacing:.18em;
  color:var(--neon);text-transform:uppercase;margin-bottom:12px;
}
.dl-help-title{
  font-family:var(--serif);font-weight:400;font-size:24px;
  letter-spacing:-.02em;margin-bottom:14px;
}
.dl-help-body{
  font-family:var(--mono);font-size:13px;line-height:1.75;color:var(--t-mid);
}
.dl-help-body ol{padding-left:20px;margin-top:10px}
.dl-help-body code{color:var(--neon)}
```

**Step 3: Add Help button state to platform data**

Add a `help` object only for Windows/macOS entries:

```js
help: {
  label: 'Windows blocked this?',
  title: 'If Windows SmartScreen appears',
  body: `
    <p>Unsigned early builds may trigger SmartScreen.</p>
    <ol>
      <li>Click <strong>More info</strong>.</li>
      <li>Click <strong>Run anyway</strong> if you trust the build source.</li>
      <li>If Windows Firewall appears, allow local/private network access only if you plan to reach the station from another device.</li>
    </ol>
  `,
}
```

macOS example:

```js
help: {
  label: 'macOS blocked this?',
  title: 'If macOS Gatekeeper appears',
  body: `
    <p>Unsigned early builds may need manual approval.</p>
    <ol>
      <li>Right-click the Paperweight binary and choose <strong>Open</strong>.</li>
      <li>If needed, open <strong>System Settings → Privacy & Security</strong>.</li>
      <li>Choose <strong>Open Anyway</strong>.</li>
    </ol>
  `,
}
```

**Step 4: Render help button conditionally**

The existing help button always links to Discord. Change it into a platform-aware button:

```html
<button class="mc-help-btn" id="dl-help-btn" type="button" title="Installer help" hidden>Help</button>
```

In `renderTerm(key)`:

```js
const helpBtn = document.getElementById('dl-help-btn');
if (p.help) {
  helpBtn.hidden = false;
  helpBtn.textContent = p.help.label;
} else {
  helpBtn.hidden = true;
  helpBtn.textContent = 'Help';
}
```

**Step 5: Add modal open/close functions**

```js
function openHelpModal() {
  const p = PLATFORMS[activePlatform];
  if (!p?.help) return;
  document.getElementById('dl-help-title').textContent = p.help.title;
  document.getElementById('dl-help-body').innerHTML = p.help.body;
  document.getElementById('dl-help-backdrop').hidden = false;
}

function closeHelpModal() {
  document.getElementById('dl-help-backdrop').hidden = true;
}

document.getElementById('dl-help-btn').addEventListener('click', openHelpModal);
document.getElementById('dl-help-close').addEventListener('click', closeHelpModal);
document.getElementById('dl-help-backdrop').addEventListener('click', e => {
  if (e.target.id === 'dl-help-backdrop') closeHelpModal();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeHelpModal();
});
```

**Step 6: Verify JS parses**

```bash
node -e "const fs=require('fs'); const html=fs.readFileSync('landing/download.html','utf8'); const js=html.match(/<script>([\s\S]*)<\/script>/)[1]; new Function(js); console.log('download page JS parses')"
```

Expected: PASS.

**Step 7: Commit**

```bash
git add landing/download.html
git commit -m "feat: add contextual installer help modals"
```

---

## Task 7: Add a minimal browser smoke checklist for the download page

**Objective:** Provide repeatable manual QA for this UI since it is mostly static HTML/JS.

**Files:**
- Create: `docs/qa/download-page-checklist.md`

**Step 1: Create checklist**

```markdown
# Download Page QA Checklist

## Platform selection

- [ ] Page auto-selects current OS when possible.
- [ ] Windows row selects Windows instructions.
- [ ] macOS Apple Silicon row selects ARM64 instructions.
- [ ] macOS Intel row selects x64 instructions.
- [ ] Linux row selects Linux instructions.
- [ ] Raspberry Pi row selects ARM64 instructions.

## Download gating

- [ ] Download button is disabled initially.
- [ ] Checking license only keeps button disabled.
- [ ] Checking content responsibility too still keeps button disabled until email is valid.
- [ ] Entering invalid email keeps button disabled.
- [ ] Entering valid email plus both legal checks enables button.
- [ ] Selecting updates does not change enabled/disabled state when email is already valid.

## Email capture

- [ ] Clicking download always posts `/api/download-lead` with `{ email, platform, updatesOptIn }`.
- [ ] With updates unchecked, payload includes `updatesOptIn: false` and success shows “Email saved for this download.”
- [ ] With updates checked, payload includes `updatesOptIn: true` and success shows “Updates enabled for …”.
- [ ] Failed capture shows non-blocking error and still opens download.

## Help modals

- [ ] Windows help button opens SmartScreen/firewall help modal.
- [ ] macOS help button opens Gatekeeper help modal.
- [ ] Linux/Pi hide contextual modal help.
- [ ] Escape closes the modal.
- [ ] Clicking backdrop closes the modal.
- [ ] Close button closes the modal.

## Responsive

- [ ] 390px wide mobile viewport remains usable.
- [ ] Platform drawer rows are tappable.
- [ ] Modal fits inside viewport.
```

**Step 2: Commit**

```bash
git add docs/qa/download-page-checklist.md
git commit -m "docs: add download page qa checklist"
```

---

## Task 8: Run final verification

**Objective:** Confirm backend tests and frontend static checks pass.

**Files:**
- No code changes unless verification reveals a bug.

**Step 1: Run focused backend tests**

```bash
node --test test/http.test.js
```

Expected: PASS.

**Step 2: Run migration check**

```bash
npm run check:migrations
```

Expected: PASS.

**Step 3: Run frontend script parse check**

```bash
node -e "const fs=require('fs'); const html=fs.readFileSync('landing/download.html','utf8'); const js=html.match(/<script>([\s\S]*)<\/script>/)[1]; new Function(js); console.log('download page JS parses')"
```

Expected:

```text
download page JS parses
```

**Step 4: Optional manual local smoke**

Run app:

```bash
PAPERWEIGHT_ALLOW_MISSING_ENV=true DASHBOARD_TOKEN=test npm start
```

Open the download page route currently used by the project and run the QA checklist.

**Step 5: Commit verification notes only if docs changed**

If you add a manual QA note, commit it:

```bash
git add docs/qa/download-page-checklist.md
git commit -m "docs: record download page qa results"
```

---

## Acceptance Criteria

- Primary Windows/macOS installer selection remains inline, not modal-driven.
- Legal/content acknowledgement is still required before download.
- Valid email is still required before download.
- “Send me important release/setup updates” is an optional checkbox and does not control whether download is enabled.
- Every download click attempts to save `{ email, platform, updatesOptIn }`.
- `updatesOptIn = 1` is stored only when the user explicitly checks the updates box.
- Lead capture failure never blocks the download.
- Windows/macOS help is available via small secondary modals.
- Linux/Pi do not show irrelevant Windows/macOS modal help.
- Backend email capture validates email, normalizes platform, and stores update consent separately from required email capture.
- Existing dashboard download-leads view continues to work.
- No unrelated landing/download route/link issues are changed by this implementation.

---

## Suggested Commit Sequence

1. `test: cover download lead capture`
2. `feat: track download update opt-in`
3. `fix: validate download lead submissions`
4. `feat: make download updates opt-in optional`
5. `feat: capture required download email before opening download`
6. `feat: add contextual installer help modals`
7. `docs: add download page qa checklist`

---

## Follow-Up Plan Later

Make a separate plan for unrelated launch-readiness issues:

- `/download` vs `/landing/download` routing.
- Landing CTA href consistency.
- Legal link href consistency.
- Real release asset URLs instead of Discord placeholders.
- README/source-install narrative vs executable-download narrative.
