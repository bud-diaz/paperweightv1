const SESSION_KEY = 'pw_dash_token';

function el(id) { return document.getElementById(id); }
function dashFetch(url, opts = {}) {
  const token = sessionStorage.getItem(SESSION_KEY);
  if (token) {
    opts.headers = { ...(opts.headers || {}), 'X-Dashboard-Token': token };
  }
  return fetch(url, opts);
}

// ── Auth ──────────────────────────────────────────────────────────────────────

async function tryAuth() {
  const res = await dashFetch('/api/dashboard/vault');
  if (res.ok) return true;
  if (res.status === 401) return false;
  return false;
}

function showAuthOverlay() {
  el('dash-auth').hidden    = false;
  el('dash-content').hidden = true;

  el('dash-token-btn').addEventListener('click', async () => {
    const token = el('dash-token-input').value.trim();
    if (!token) return;
    sessionStorage.setItem(SESSION_KEY, token);
    const ok = await tryAuth();
    if (ok) {
      revealDashboardNav();
      el('dash-auth').hidden    = true;
      el('dash-content').hidden = false;
      loadDashboard();
    } else {
      sessionStorage.removeItem(SESSION_KEY);
      el('dash-auth-msg').className   = 'error-msg';
      el('dash-auth-msg').textContent = 'Invalid token';
    }
  }, { once: true });
}

// ── Vault stats ───────────────────────────────────────────────────────────────

async function loadVaultStats() {
  const res = await dashFetch('/api/dashboard/vault');
  const d   = await res.json();
  el('vault-stats').innerHTML = `
    <div class="stat-card"><div class="stat-value">${d.totalFiles}</div><div class="stat-label">Total Files</div></div>
    <div class="stat-card"><div class="stat-value">${d.totalHours}h</div><div class="stat-label">Total Duration</div></div>
    ${Object.entries(d.byCategory).map(([cat, n]) =>
      `<div class="stat-card"><div class="stat-value">${n}</div><div class="stat-label">${cap(cat)}</div></div>`
    ).join('')}
  `;
}

// ── Station registry ──────────────────────────────────────────────────────────

async function loadStation() {
  const res  = await dashFetch('/api/dashboard/station');
  const data = await res.json();

  if (!data.slug) {
    el('station-reg-content').hidden = true;
    el('station-unclaimed').hidden   = false;
    return;
  }

  el('station-unclaimed').hidden   = true;
  el('station-reg-content').hidden = false;

  el('station-slug').textContent        = data.slug;
  el('station-public-url').textContent  = data.url;
  el('station-url-input').placeholder   = data.url;

  el('btn-copy-url').onclick = () => {
    navigator.clipboard.writeText(data.url);
    el('btn-copy-url').textContent = 'Copied!';
    setTimeout(() => { el('btn-copy-url').textContent = 'Copy'; }, 2000);
  };

  checkHealth();
}

async function checkHealth() {
  setHealthDot('checking');
  const res    = await dashFetch('/api/dashboard/station/health');
  const result = await res.json();
  setHealthDot(result.reachable === true ? 'up' : result.reachable === false ? 'down' : 'unknown', result);
}

function setHealthDot(state, result = {}) {
  const dot    = el('health-dot');
  const status = el('health-status');
  const colors = { up: 'var(--green)', down: '#e84040', checking: 'var(--muted)', unknown: 'var(--muted)' };
  dot.style.background = colors[state] || colors.unknown;

  if (state === 'up') {
    dot.title        = 'Reachable';
    status.textContent = `Reachable · ${result.latencyMs}ms`;
    status.style.color = 'var(--green)';
  } else if (state === 'down') {
    dot.title          = result.error || 'Unreachable';
    status.textContent = result.error ? `Unreachable — ${result.error}` : 'Unreachable';
    status.style.color = '#e84040';
  } else {
    dot.title          = 'Checking…';
    status.textContent = 'Checking…';
    status.style.color = 'var(--muted)';
  }
}

function setupStationUpdate() {
  el('btn-recheck-health').addEventListener('click', checkHealth);

  el('btn-update-url').addEventListener('click', async () => {
    const url = el('station-url-input').value.trim();
    const msg = el('station-url-msg');
    if (!url) return;

    const res = await dashFetch('/api/dashboard/station/url', {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ url }),
    });
    const data = await res.json();

    if (res.ok) {
      msg.className   = 'success-msg';
      msg.textContent = 'URL updated.';
      el('station-public-url').textContent = url;
      setTimeout(() => { msg.textContent = ''; }, 3000);
      checkHealth();
    } else {
      msg.className   = 'error-msg';
      msg.textContent = data.error || 'Update failed';
    }
  });
}

// ── Broadcast ─────────────────────────────────────────────────────────────────

async function loadBroadcast() {
  const res  = await fetch('/api/stream/status');
  const data = await res.json();
  const np   = data.nowPlaying;

  el('dash-now-playing').textContent = np ? `${np.title}${np.artist ? ' — ' + np.artist : ''}` : 'Nothing playing';
  el('dash-mode').textContent        = `Mode: ${data.mode}`;

  const modeBtn = el('btn-toggle-mode');
  modeBtn.textContent = data.mode === 'shuffle' ? 'Switch to Scheduled' : 'Switch to Shuffle';
  modeBtn.onclick = async () => {
    const newMode = data.mode === 'shuffle' ? 'scheduled' : 'shuffle';
    await dashFetch('/api/dashboard/broadcast/mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: newMode }),
    });
    loadBroadcast();
  };

  el('btn-restart').onclick = async () => {
    el('btn-restart').textContent = 'Restarting…';
    await dashFetch('/api/dashboard/broadcast/restart', { method: 'POST' });
    setTimeout(() => { el('btn-restart').textContent = 'Restart'; loadBroadcast(); }, 1500);
  };
}

// ── Upload ────────────────────────────────────────────────────────────────────

let uploadFiles = [];

function setupUpload() {
  const zone  = el('upload-zone');
  const input = el('upload-input');

  zone.addEventListener('click',  () => input.click());
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    queueFiles(Array.from(e.dataTransfer.files));
  });
  input.addEventListener('change', () => queueFiles(Array.from(input.files)));

  el('upload-submit').addEventListener('click', submitUploads);
}

function queueFiles(files) {
  uploadFiles = files;
  const form  = el('upload-form');
  const queue = el('upload-queue');
  form.hidden = false;
  queue.innerHTML = files.map(f =>
    `<div style="font-size:13px;color:var(--muted);margin-top:4px">• ${f.name} (${(f.size/1024/1024).toFixed(1)} MB)</div>`
  ).join('');
}

async function submitUploads() {
  const msg        = el('upload-msg');
  const category   = el('upload-category').value;
  const visibility = el('upload-visibility').value;
  msg.textContent  = '';

  for (const file of uploadFiles) {
    const fd = new FormData();
    fd.append('media', file);
    fd.append('category', category);
    fd.append('visibility', visibility);

    try {
      const res = await dashFetch('/api/dashboard/upload', { method: 'POST', body: fd });
      if (!res.ok) throw new Error((await res.json()).error || 'Upload failed');
      msg.className   = 'success-msg';
      msg.textContent = `Uploaded: ${file.name}`;
    } catch (err) {
      msg.className   = 'error-msg';
      msg.textContent = err.message;
    }
  }
  uploadFiles = [];
  el('upload-form').hidden = true;
  setTimeout(() => { loadVaultStats(); loadMedia(); }, 2000);
}

// ── Tokens ────────────────────────────────────────────────────────────────────

async function loadTokens() {
  const res    = await dashFetch('/api/dashboard/tokens');
  const tokens = await res.json();

  el('token-list').innerHTML = tokens.length
    ? tokens.map(t => `
        <div class="token-row">
          <span class="token-label">${esc(t.label || '—')}</span>
          <span class="token-meta">${t.tier} · ${t.last_used ? 'used ' + t.last_used.slice(0,10) : 'never used'}</span>
          <button class="btn btn-sm btn-danger" data-revoke="${t.id}" ${!t.is_active ? 'disabled' : ''}>
            ${t.is_active ? 'Revoke' : 'Revoked'}
          </button>
        </div>
      `).join('')
    : '<div class="empty">No tokens yet.</div>';

  el('token-list').querySelectorAll('[data-revoke]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await dashFetch(`/api/dashboard/tokens/${btn.dataset.revoke}`, { method: 'DELETE' });
      loadTokens();
    });
  });
}

function setupTokenCreate() {
  el('btn-create-token').addEventListener('click', async () => {
    const label = el('new-token-label').value.trim();
    if (!label) return;
    const res  = await dashFetch('/api/dashboard/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label }),
    });
    const data = await res.json();
    if (res.ok) {
      el('new-token-result').innerHTML = `
        <div class="success-msg" style="margin-top:8px">Token created:</div>
        <code style="display:block;background:var(--surface2);border-radius:4px;font-size:12px;margin-top:4px;padding:8px;word-break:break-all">${data.token}</code>
        <div style="color:var(--muted);font-size:11px;margin-top:4px">Share this once — it won't be shown again.</div>
      `;
      el('new-token-label').value = '';
      loadTokens();
    }
  });
}

// ── Schedule ──────────────────────────────────────────────────────────────────

async function loadSchedule() {
  const res    = await dashFetch('/api/schedule');
  const blocks = await res.json();

  el('schedule-list').innerHTML = blocks.length
    ? blocks.map(b => {
        const dayLabel = b.day_of_week != null ? DAY_NAMES[b.day_of_week] : 'Daily';
        return `
        <div class="block-row">
          <span class="block-label">${esc(b.label || '—')}</span>
          <span class="badge">${dayLabel}</span>
          <span class="block-time">${b.start_time}–${b.end_time}</span>
          <span class="badge">${b.category || 'any'}</span>
          <span class="badge">${b.mode}</span>
          <button class="btn btn-sm btn-danger" data-del-block="${b.id}">Delete</button>
        </div>`;
      }).join('')
    : '<div class="empty">No schedule blocks. Station runs in shuffle mode.</div>';

  el('schedule-list').querySelectorAll('[data-del-block]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await dashFetch(`/api/schedule/blocks/${btn.dataset.delBlock}`, { method: 'DELETE' });
      loadSchedule();
    });
  });
}

const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function setupScheduleCreate() {
  el('btn-add-block').addEventListener('click', async () => {
    const dayVal = el('sched-day').value;
    const body = {
      label:        el('sched-label').value.trim() || null,
      day_of_week:  dayVal !== '' ? parseInt(dayVal, 10) : null,
      start_time:   el('sched-start').value,
      end_time:     el('sched-end').value,
      category:     el('sched-category').value || null,
      mode:         el('sched-mode').value,
    };
    if (!body.start_time || !body.end_time) return;
    await dashFetch('/api/schedule/blocks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    loadSchedule();
  });
}

// ── Media ─────────────────────────────────────────────────────────────────────

const VISIBILITY_LABELS = { public: 'Public', supporters_only: 'Supporters Only', private: 'Private' };

async function loadMedia() {
  const res   = await dashFetch('/api/dashboard/media');
  const items = await res.json();
  const list  = el('media-list');

  if (!items.length) {
    list.innerHTML = '<div class="empty">No media in vault yet.</div>';
    return;
  }

  list.innerHTML = items.map(item => `
    <div class="media-row" data-media-id="${item.id}">
      <div class="media-row-info">
        <span class="media-row-title">${esc(item.title || item.filename)}</span>
        <span class="badge">${esc(item.category)}</span>
      </div>
      <div class="media-row-controls">
        <select class="media-vis-select" data-id="${item.id}">
          <option value="public"${item.visibility === 'public' ? ' selected' : ''}>Public</option>
          <option value="supporters_only"${item.visibility === 'supporters_only' ? ' selected' : ''}>Supporters Only</option>
          <option value="private"${item.visibility === 'private' ? ' selected' : ''}>Private</option>
        </select>
        <button class="btn btn-sm media-save-btn" data-id="${item.id}">Save</button>
        <span class="media-save-msg" data-id="${item.id}"></span>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.media-save-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id         = btn.dataset.id;
      const select     = list.querySelector(`.media-vis-select[data-id="${id}"]`);
      const msgEl      = list.querySelector(`.media-save-msg[data-id="${id}"]`);
      const visibility = select.value;

      btn.disabled = true;
      const saveRes = await dashFetch(`/api/dashboard/media/${id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ visibility }),
      });
      btn.disabled = false;

      if (saveRes.ok) {
        msgEl.className   = 'success-msg';
        msgEl.textContent = 'Saved';
        setTimeout(() => { msgEl.textContent = ''; }, 2000);
      } else {
        msgEl.className   = 'error-msg';
        msgEl.textContent = 'Failed';
      }
    });
  });
}

// ── Analytics ─────────────────────────────────────────────────────────────────

async function loadAnalytics() {
  const [liveRes, topRes] = await Promise.all([
    dashFetch('/api/analytics/live'),
    dashFetch('/api/analytics/top?limit=5'),
  ]);
  const live = await liveRes.json();
  const top  = await topRes.json();

  el('analytics-stats').innerHTML = `
    <div class="stat-card"><div class="stat-value">${live.currentListeners}</div><div class="stat-label">Listening Now</div></div>
    <div class="stat-card"><div class="stat-value">${live.peakToday}</div><div class="stat-label">Peak Today</div></div>
    ${top.length ? `
      <div class="stat-card" style="grid-column:span 2">
        <div class="stat-label" style="margin-bottom:8px">Top Tracks (7 days)</div>
        ${top.map(t => `<div style="font-size:13px;padding:2px 0">${esc(t.title || t.filename)}</div>`).join('')}
      </div>` : ''}
  `;
}

// ── Payment Config ────────────────────────────────────────────────────────────

async function loadPaymentConfig() {
  const res  = await dashFetch('/api/dashboard/payment-config');
  if (!res.ok) return;
  const d = await res.json();
  const box = el('payment-config-status');

  const check = ok => ok
    ? '<span style="color:var(--green)">✓</span>'
    : '<span style="color:#e84040">✗ missing</span>';

  const stripeSetup = !d.stripe.connected ? `
    <div class="setup-notice">
      <strong>Stripe not configured.</strong> Add these to your <code>.env</code> to enable subscriptions and tips:
      <pre style="margin:8px 0 0;font-size:11px;color:var(--muted)">STRIPE_SECRET_KEY=sk_live_...        # Stripe Dashboard → Developers → API keys
STRIPE_WEBHOOK_SECRET=whsec_...     # Stripe Dashboard → Developers → Webhooks
STRIPE_PRICE_SUBSCRIBER=price_...   # Stripe Dashboard → Products (create a recurring price)
STRIPE_PRICE_PRO=price_...
STRIPE_PRICE_ALL_ACCESS=price_...</pre>
    </div>` : '';

  box.innerHTML = `
    <div class="payment-status-grid">
      <div class="stat-card">
        <div class="stat-label">Stripe</div>
        <div style="font-size:13px;margin-top:6px;line-height:1.8">
          Secret key ${check(d.stripe.connected)}<br>
          Webhook secret ${check(d.stripe.webhookConfigured)}<br>
          Subscriber price ${check(d.stripe.prices.subscriber)}<br>
          Pro price ${check(d.stripe.prices.pro)}<br>
          All-Access price ${check(d.stripe.prices.allAccess)}
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-label">PayPal</div>
        <div style="font-size:13px;margin-top:6px;line-height:1.8">
          Credentials ${check(d.paypal.connected)}<br>
          Pro plan ${check(d.paypal.plans.pro)}<br>
          All-Access plan ${check(d.paypal.plans.allAccess)}
        </div>
      </div>
    </div>
    ${stripeSetup}
  `;
}

// ── Tip Config ────────────────────────────────────────────────────────────────

async function loadTipConfig() {
  const res  = await dashFetch('/api/dashboard/tip-config');
  const data = await res.json();
  const amounts = data.amounts || [300, 500, 1000];
  el('tip-amount-1').value        = amounts[0] / 100;
  el('tip-amount-2').value        = amounts[1] / 100;
  el('tip-amount-3').value        = amounts[2] / 100;
  el('tip-custom-enabled').checked = !!data.customEnabled;
}

function setupTipConfig() {
  el('btn-save-tip-config').addEventListener('click', async () => {
    const amounts = [
      Math.round(parseFloat(el('tip-amount-1').value) * 100),
      Math.round(parseFloat(el('tip-amount-2').value) * 100),
      Math.round(parseFloat(el('tip-amount-3').value) * 100),
    ];
    const customEnabled = el('tip-custom-enabled').checked;
    const msg = el('tip-config-msg');

    const res  = await dashFetch('/api/dashboard/tip-config', {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ amounts, customEnabled }),
    });
    const data = await res.json();

    if (res.ok) {
      msg.className   = 'success-msg';
      msg.textContent = 'Saved';
      setTimeout(() => { msg.textContent = ''; }, 2000);
    } else {
      msg.className   = 'error-msg';
      msg.textContent = data.error || 'Failed';
    }
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────

function cap(s) { return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()); }
function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function loadDashboard() {
  await Promise.all([
    loadStation(),
    loadVaultStats(),
    loadBroadcast(),
    loadMedia(),
    loadTokens(),
    loadSchedule(),
    loadAnalytics(),
    loadPaymentConfig(),
    loadTipConfig(),
  ]);
}

function revealDashboardNav() {
  const navLink    = document.getElementById('nav-dashboard-link');
  const footerLink = document.getElementById('footer-dashboard-link');
  if (navLink)    navLink.style.display    = '';
  if (footerLink) footerLink.style.display = '';
}

export async function initDashboard() {
  const authed = await tryAuth();
  if (!authed) {
    showAuthOverlay();
    return;
  }

  revealDashboardNav();
  el('dash-auth').hidden    = true;
  el('dash-content').hidden = false;

  setupUpload();
  setupTokenCreate();
  setupScheduleCreate();
  setupStationUpdate();
  setupTipConfig();
  loadDashboard();
}
