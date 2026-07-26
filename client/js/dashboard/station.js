/**
 * dashboard/station.js — Station registration, health, and URL management.
 */

import * as api from '../api.js';
import { el, esc } from '../utils.js';
import { applyTunnelState } from './desktop-controls.js';
import * as dashDrawers from './drawers.js';

export function init() {}

function renderSearchableControls(data) {
  const toggle = el('set-station-searchable');
  const hint = el('station-searchable-hint');
  const msg = el('station-searchable-msg');
  const requirements = data.requirements || {};
  const missing = [];

  toggle.checked = !!data.searchable;
  msg.textContent = '';
  msg.className = '';

  if (!requirements.cloudflareTunnel) missing.push('a Cloudflare tunnel token in .env');
  if (!requirements.publicUrlSet) missing.push('a registered public URL');

  toggle.disabled = missing.length > 0;

  if (missing.length) {
    hint.textContent = `Requires ${missing.join(' and ')}.`;
    if (data.searchable) {
      msg.className = 'dash-error-msg';
      msg.textContent = `Searchability is on, but now missing ${missing.join(' and ')}. Directory removal follows the next telemetry update.`;
    }
  } else {
    hint.textContent = 'Reachability is verified when you switch this on. Directory updates within ~5 minutes.';
  }
}

function renderTelemetryStatus(configured, hasSlug) {
  const status = el('pape-secret-status');
  const registerBtn = el('btn-register-pape');
  if (!status) return;
  if (configured) {
    status.textContent = 'Configured — reporting to system.pape.';
  } else if (!hasSlug) {
    status.textContent = 'Claim a station slug first to register.';
  } else {
    status.textContent = 'Not configured — the paperweighthq.com vanity URL and directory listing will not work.';
  }
  if (registerBtn) registerBtn.disabled = !hasSlug;
}

function describeFailedChecks(checks = {}) {
  const failed = [];
  if (checks.cloudflareTunnel === false) failed.push('Cloudflare tunnel token missing');
  if (checks.publicUrlSet === false) failed.push('public URL missing');
  if (checks.reachable === false) failed.push('station unreachable');
  return failed.length ? ` (${failed.join(', ')})` : '';
}

const SETUP_STEPS = [
  { key: 'install_completed',    label: 'Installed and running' },
  { key: 'first_track_scanned',  label: 'First track added to your vault' },
  { key: 'went_public',          label: 'Station went public' },
  { key: 'first_listener',       label: 'First listener tuned in' },
];

export async function loadSetupProgress() {
  const section = el('setup-progress-section');
  const list = el('setup-progress-list');
  const signupSection = el('dashboard-signup-section');
  if (!section || !list) return;
  try {
    const { milestones, signupDismissed } = await api.dashboard.setupProgress();
    // Hide once everything is checked off — this is a first-run nudge, not a
    // permanent dashboard fixture.
    const allDone = SETUP_STEPS.every(step => milestones[step.key]);
    section.hidden = allDone;
    if (!allDone) {
      list.innerHTML = SETUP_STEPS.map(step => {
        const done = !!milestones[step.key];
        return `<div style="display:flex;align-items:center;gap:8px;padding:3px 0;font-family:'Space Mono',monospace;font-size:11px;color:${done ? '#39ff14' : 'rgba(255,255,255,.35)'};">
          <span>${done ? '✓' : '○'}</span><span>${esc(step.label)}</span>
        </div>`;
      }).join('');
    }

    // The optional signup prompt appears after the station's first real
    // listener — a clear, universally-reachable high-intent moment. (Not
    // "first broadcast start": broadcast.start('shuffle') runs automatically
    // on every boot regardless of any creator action, so it wouldn't signal
    // intent. Not "went public": that requires opting into search
    // discoverability, which plenty of creators with their own existing
    // audience may never enable.) Shown once, unless dismissed or already
    // submitted.
    if (signupSection) signupSection.hidden = signupDismissed || !milestones.first_listener;
  } catch {
    section.hidden = true;
    if (signupSection) signupSection.hidden = true;
  }
}

export async function loadDashStation() {
  loadSetupProgress();
  try {
    const data = await api.dashboard.station.get();
    renderSearchableControls(data);
    renderTelemetryStatus(data.telemetryConfigured, !!data.slug);
    applyTunnelState(data);
    if (data.cloudflareApiConfigured) loadCloudflareZones();
    const tunnelSection = el('paperweighthq-tunnel-section');
    if (tunnelSection) tunnelSection.hidden = !data.paperweighthqTunnelAvailable;
    if (!data.slug) {
      el('station-unclaimed').hidden   = false;
      el('station-reg-content').hidden = true;
      dashDrawers.updateHealth({ label: 'UNCLAIMED', url: '' });
      return;
    }
    el('station-unclaimed').hidden   = true;
    el('station-reg-content').hidden = false;
    el('station-public-url').textContent    = data.url || '';
    el('station-url-input').placeholder     = data.url || 'https://radio.yoursite.com';

    el('btn-copy-url').onclick = () => {
      navigator.clipboard?.writeText(data.url).catch(() => {});
      el('btn-copy-url').textContent = 'COPIED';
      setTimeout(() => { el('btn-copy-url').textContent = 'COPY'; }, 2000);
    };

    checkStationHealth();
  } catch {}
}

async function loadCloudflareZones() {
  const section = el('cf-tunnel-section');
  const select = el('cf-zone-select');
  try {
    const data = await api.dashboard.station.cloudflareZones();
    if (data.error || !data.zones) {
      section.hidden = true;
      return;
    }
    select.innerHTML = data.zones.map(z => `<option value="${esc(z.id)}">${esc(z.name)}</option>`).join('');
    section.hidden = false;
  } catch {
    section.hidden = true;
  }
}

export async function checkStationHealth() {
  const dot    = el('health-dot');
  const status = el('health-status');
  dot.style.background = 'rgba(255,255,255,.25)';
  status.textContent   = 'Checking…';
  status.style.color   = 'rgba(255,255,255,.3)';
  dashDrawers.updateHealth({ label: 'Checking…', url: el('station-public-url')?.textContent || '' });
  try {
    const res = await api.dashboard.station.health();
    if (res.reachable === true) {
      dot.style.background = '#39ff14';
      status.textContent   = `Reachable · ${res.latencyMs}ms`;
      status.style.color   = '#39ff14';
      dashDrawers.updateHealth({ state: 'ok', label: 'Reachable', url: el('station-public-url')?.textContent || '' });
    } else {
      dot.style.background = '#ff4466';
      status.textContent   = res.error ? `Unreachable — ${res.error}` : 'Unreachable';
      status.style.color   = '#ff4466';
      dashDrawers.updateHealth({ state: 'error', label: 'Unreachable', url: el('station-public-url')?.textContent || '' });
    }
  } catch {
    dot.style.background = 'rgba(255,255,255,.2)';
    status.textContent   = 'Check failed';
    dashDrawers.updateHealth({ state: 'error', label: 'Check failed', url: el('station-public-url')?.textContent || '' });
  }
}

// Polls the supervised cloudflared connector's status a few times after
// auto-tunnel creation, since "connecting" -> "connected" happens
// asynchronously in the background (src/runtime/tunnel-supervisor.js).
// Stops early on a terminal state, or after a fixed number of tries so a
// stuck connector doesn't poll forever.
async function pollTunnelStatus(resultEl, attemptsLeft = 8) {
  try {
    const status = await api.dashboard.station.getTunnelStatus();
    resultEl.textContent = status.status === 'connected'
      ? 'Tunnel connected.'
      : status.status === 'error'
        ? `Tunnel error: ${status.lastError || 'unknown error'}`
        : 'Connecting…';
    if (status.status === 'connected' || status.status === 'error' || attemptsLeft <= 1) return;
  } catch {
    if (attemptsLeft <= 1) return;
  }
  setTimeout(() => pollTunnelStatus(resultEl, attemptsLeft - 1), 1500);
}

export function initStationHandlers() {
  el('btn-recheck-health').addEventListener('click', checkStationHealth);

  el('btn-dashboard-signup').addEventListener('click', async () => {
    const email = el('dashboard-signup-email').value.trim();
    const msg = el('dashboard-signup-msg');
    const btn = el('btn-dashboard-signup');
    if (!email) return;
    btn.disabled = true;
    const { res, data } = await api.dashboard.signup(email, true);
    btn.disabled = false;
    if (res.ok) {
      msg.style.color = '#39ff14';
      msg.textContent = 'Thanks — you\'re signed up.';
      await api.dashboard.dismissSignup();
      setTimeout(() => { el('dashboard-signup-section').hidden = true; }, 1500);
    } else {
      msg.style.color = '#ff6b6b';
      msg.textContent = data.error || 'Could not sign up';
    }
  });

  el('btn-dashboard-signup-dismiss').addEventListener('click', async () => {
    await api.dashboard.dismissSignup();
    el('dashboard-signup-section').hidden = true;
  });

  el('set-station-searchable').addEventListener('change', async () => {
    const toggle = el('set-station-searchable');
    const msg = el('station-searchable-msg');
    const checked = toggle.checked;
    toggle.disabled = true;
    msg.textContent = '';
    msg.className = '';

    try {
      const { res, data } = await api.dashboard.station.setSearchable(checked);
      if (res.ok) {
        msg.className = 'dash-success-msg';
        msg.textContent = checked
          ? 'Station will appear in the directory within ~5 minutes.'
          : 'Station will be removed from the directory within ~5 minutes.';
        setTimeout(() => { msg.textContent = ''; }, 3000);
      } else {
        toggle.checked = !checked;
        msg.className = 'dash-error-msg';
        msg.textContent = `${data.error || 'Update failed'}${describeFailedChecks(data.checks)}`;
        checkStationHealth();
      }
    } catch {
      toggle.checked = !checked;
      msg.className = 'dash-error-msg';
      msg.textContent = 'Update failed';
      checkStationHealth();
    } finally {
      toggle.disabled = false;
    }
  });

  el('btn-update-url').addEventListener('click', async () => {
    const url = el('station-url-input').value.trim();
    const msg = el('station-url-msg');
    if (!url) return;
    const { res, data } = await api.dashboard.station.updateUrl(url);
    if (res.ok) {
      msg.className   = 'dash-success-msg';
      msg.textContent = 'URL updated.';
      el('station-public-url').textContent = url;
      setTimeout(() => { msg.textContent = ''; }, 3000);
      checkStationHealth();
    } else {
      msg.className   = 'dash-error-msg';
      msg.textContent = data.error || 'Update failed';
    }
  });

  el('btn-save-cf-token').addEventListener('click', async () => {
    const apiToken = el('cf-api-token-input').value.trim();
    const msg = el('cf-token-msg');
    if (!apiToken) return;
    msg.textContent = '';
    msg.className = '';
    const { res, data } = await api.dashboard.station.saveCloudflareToken(apiToken);
    if (res.ok) {
      msg.className   = 'dash-success-msg';
      msg.textContent = 'Token saved and verified.';
      el('cf-api-token-input').value = '';
      loadCloudflareZones();
    } else {
      msg.className   = 'dash-error-msg';
      msg.textContent = data.error || 'Could not verify token';
    }
  });

  el('btn-register-pape').addEventListener('click', async () => {
    const button = el('btn-register-pape');
    const msg = el('pape-secret-msg');
    msg.textContent = '';
    msg.className = '';
    button.disabled = true;
    try {
      const { res, data } = await api.dashboard.station.registerTelemetry();
      if (res.ok) {
        msg.className   = 'dash-success-msg';
        msg.textContent = data.note || 'Registered. Restart Paperweight to start reporting.';
        renderTelemetryStatus(true, true);
      } else {
        msg.className   = 'dash-error-msg';
        msg.textContent = data.error || 'Could not register with system.pape';
      }
    } finally {
      button.disabled = false;
    }
  });

  el('btn-save-pape-secret').addEventListener('click', async () => {
    const secret = el('pape-secret-input').value.trim();
    const msg = el('pape-secret-msg');
    if (!secret) return;
    msg.textContent = '';
    msg.className = '';
    const { res, data } = await api.dashboard.station.saveTelemetrySecret(secret);
    if (res.ok) {
      msg.className   = 'dash-success-msg';
      msg.textContent = data.note || 'Secret saved. Restart Paperweight to start reporting.';
      el('pape-secret-input').value = '';
      renderTelemetryStatus(true);
    } else {
      msg.className   = 'dash-error-msg';
      msg.textContent = data.error || 'Could not save secret';
    }
  });

  el('btn-auto-tunnel').addEventListener('click', async () => {
    const zoneId = el('cf-zone-select').value;
    const hostname = el('cf-hostname-input').value.trim();
    const msg = el('cf-tunnel-msg');
    const result = el('cf-tunnel-result');
    if (!zoneId || !hostname) return;
    msg.textContent = '';
    msg.className = '';
    result.hidden = true;
    const button = el('btn-auto-tunnel');
    button.disabled = true;
    try {
      const { res, data } = await api.dashboard.station.autoCreateTunnel(zoneId, hostname);
      if (res.ok) {
        msg.className   = 'dash-success-msg';
        msg.textContent = `Tunnel created for ${data.url}. Connecting…`;
        result.hidden = false;
        el('station-public-url').textContent = data.url;
        checkStationHealth();
        pollTunnelStatus(result);
      } else {
        msg.className   = 'dash-error-msg';
        msg.textContent = data.error || 'Could not create tunnel';
      }
    } finally {
      button.disabled = false;
    }
  });

  el('btn-paperweighthq-tunnel').addEventListener('click', async () => {
    const button = el('btn-paperweighthq-tunnel');
    const msg = el('paperweighthq-tunnel-msg');
    const result = el('paperweighthq-tunnel-result');
    msg.textContent = '';
    msg.className = '';
    result.hidden = true;
    button.disabled = true;
    try {
      const { res, data } = await api.dashboard.station.createPaperweighthqTunnel();
      if (res.ok) {
        msg.className   = 'dash-success-msg';
        msg.textContent = `Tunnel created for ${data.url}. Connecting…`;
        result.hidden = false;
        el('station-public-url').textContent = data.url;
        checkStationHealth();
        pollTunnelStatus(result);
      } else {
        msg.className   = 'dash-error-msg';
        msg.textContent = data.error || 'Could not create tunnel';
      }
    } finally {
      button.disabled = false;
    }
  });
}
