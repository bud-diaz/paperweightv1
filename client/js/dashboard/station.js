/**
 * dashboard/station.js — Station registration, health, and URL management.
 */

import * as api from '../api.js';
import { el, esc } from '../utils.js';

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

export async function loadDashStation() {
  try {
    const data = await api.dashboard.station.get();
    renderSearchableControls(data);
    renderTelemetryStatus(data.telemetryConfigured, !!data.slug);
    if (data.cloudflareApiConfigured) loadCloudflareZones();
    if (!data.slug) {
      el('station-unclaimed').hidden   = false;
      el('station-reg-content').hidden = true;
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
  try {
    const res = await api.dashboard.station.health();
    if (res.reachable === true) {
      dot.style.background = '#39ff14';
      status.textContent   = `Reachable · ${res.latencyMs}ms`;
      status.style.color   = '#39ff14';
    } else {
      dot.style.background = '#ff4466';
      status.textContent   = res.error ? `Unreachable — ${res.error}` : 'Unreachable';
      status.style.color   = '#ff4466';
    }
  } catch {
    dot.style.background = 'rgba(255,255,255,.2)';
    status.textContent   = 'Check failed';
  }
}

export function initStationHandlers() {
  el('btn-recheck-health').addEventListener('click', checkStationHealth);

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
        msg.textContent = `Tunnel created for ${data.url}.`;
        result.hidden = false;
        result.textContent = `Connector token: ${data.tunnelToken} — ${data.note || ''}`;
        el('station-public-url').textContent = data.url;
        checkStationHealth();
      } else {
        msg.className   = 'dash-error-msg';
        msg.textContent = data.error || 'Could not create tunnel';
      }
    } finally {
      button.disabled = false;
    }
  });
}
