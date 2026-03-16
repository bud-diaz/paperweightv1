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
  const msg      = el('upload-msg');
  const category = el('upload-category').value;
  msg.textContent = '';

  for (const file of uploadFiles) {
    const fd = new FormData();
    fd.append('media', file);
    fd.append('category', category);

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
  setTimeout(loadVaultStats, 2000); // vault stats update after scanner picks up file
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
    ? blocks.map(b => `
        <div class="block-row">
          <span class="block-label">${esc(b.label || '—')}</span>
          <span class="block-time">${b.start_time}–${b.end_time}</span>
          <span class="badge">${b.category || 'any'}</span>
          <span class="badge">${b.mode}</span>
          <button class="btn btn-sm btn-danger" data-del-block="${b.id}">Delete</button>
        </div>
      `).join('')
    : '<div class="empty">No schedule blocks. Station runs in shuffle mode.</div>';

  el('schedule-list').querySelectorAll('[data-del-block]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await dashFetch(`/api/schedule/blocks/${btn.dataset.delBlock}`, { method: 'DELETE' });
      loadSchedule();
    });
  });
}

function setupScheduleCreate() {
  el('btn-add-block').addEventListener('click', async () => {
    const body = {
      label:      el('sched-label').value.trim() || null,
      start_time: el('sched-start').value,
      end_time:   el('sched-end').value,
      category:   el('sched-category').value || null,
      mode:       el('sched-mode').value,
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

// ── Init ──────────────────────────────────────────────────────────────────────

function cap(s) { return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()); }
function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function loadDashboard() {
  await Promise.all([
    loadVaultStats(),
    loadBroadcast(),
    loadTokens(),
    loadSchedule(),
    loadAnalytics(),
  ]);
}

export async function initDashboard() {
  const authed = await tryAuth();
  if (!authed) {
    showAuthOverlay();
    return;
  }

  el('dash-auth').hidden    = true;
  el('dash-content').hidden = false;

  setupUpload();
  setupTokenCreate();
  setupScheduleCreate();
  loadDashboard();
}
