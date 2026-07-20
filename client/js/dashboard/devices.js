/**
 * dashboard/devices.js — Authorized devices (mobile Studio pairing).
 *
 * A creator already signed into Studio on desktop generates a QR code here;
 * scanning it with a phone signs that phone into Studio without ever typing
 * the raw dashboard token. See src/auth/device-pairing.js (short-lived
 * pairing token) and src/auth/devices.js (the resulting persistent,
 * individually revocable device credential) on the server side.
 */

import * as api from '../api.js';
import { el, esc } from '../utils.js';

export function init() {}

let pollTimer = null;

function fmtDate(iso) {
  if (!iso) return 'never';
  try {
    const normalized = String(iso).includes('T') ? iso : String(iso).replace(' ', 'T') + 'Z';
    return new Date(normalized).toLocaleString();
  } catch {
    return iso;
  }
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

export async function loadDashDevices() {
  const list = el('dash-devices-list');
  if (!list) return;
  try {
    const { devices } = await api.dashboard.devices.list();
    list.innerHTML = '';
    if (!devices || !devices.length) {
      list.innerHTML = '<div style="font-size:11px;color:rgba(255,255,255,.25);font-family:\'Space Mono\',monospace;padding:4px 14px 8px;">No paired devices yet.</div>';
      return;
    }
    for (const device of devices) list.appendChild(buildDeviceRow(device));
  } catch {
    list.innerHTML = '<div class="dash-error-msg">Failed to load devices.</div>';
  }
}

function buildDeviceRow(device) {
  const row = document.createElement('div');
  row.className = 'share-table-row';
  const revoked = !!device.revoked_at;
  row.innerHTML = `
    <div class="share-table-main">
      <span class="share-table-title">${esc(device.label)}</span>
      <div class="share-table-actions">
        ${revoked ? '' : `<button class="mgmt-btn" data-rename-device="${device.id}">RENAME</button>
        <button class="mgmt-btn danger" data-revoke-device="${device.id}">REVOKE</button>`}
      </div>
    </div>
    <div class="share-table-meta">
      paired ${esc(fmtDate(device.created_at))} / last used ${esc(fmtDate(device.last_used_at))}${revoked ? ' / REVOKED' : ''}
    </div>
  `;

  const renameBtn = row.querySelector('[data-rename-device]');
  if (renameBtn) {
    renameBtn.addEventListener('click', async () => {
      const label = prompt('Rename this device', device.label);
      if (!label || !label.trim()) return;
      await api.dashboard.devices.rename(device.id, label.trim());
      loadDashDevices();
    });
  }

  const revokeBtn = row.querySelector('[data-revoke-device]');
  if (revokeBtn) {
    revokeBtn.addEventListener('click', async () => {
      if (!confirm(`Revoke "${device.label}"? It will be signed out of Studio immediately.`)) return;
      await api.dashboard.devices.revoke(device.id);
      loadDashDevices();
    });
  }

  return row;
}

async function startPairing() {
  stopPolling();
  const qrBox  = el('dash-pair-qr');
  const urlBox = el('dash-pair-url');
  const msgBox = el('dash-pair-msg');
  if (!qrBox) return;

  msgBox.textContent = '';
  qrBox.innerHTML = 'Generating…';
  urlBox.textContent = '';

  try {
    const { pairToken, pairUrl } = await api.dashboard.devices.pair();

    qrBox.innerHTML = '';
    if (window.qrcode) {
      const qr = window.qrcode(0, 'M');
      qr.addData(pairUrl);
      qr.make();
      qrBox.innerHTML = qr.createSvgTag(5, 8);
    }
    urlBox.textContent = pairUrl;
    msgBox.textContent = 'Waiting for scan…';

    pollTimer = setInterval(async () => {
      try {
        const status = await api.dashboard.devices.pairStatus(pairToken);
        if (status.status === 'claimed') {
          stopPolling();
          msgBox.textContent = 'Device paired.';
          qrBox.innerHTML = '';
          urlBox.textContent = '';
          loadDashDevices();
        }
      } catch {
        stopPolling();
        msgBox.textContent = 'Pairing code expired — generate a new one.';
      }
    }, 2000);
  } catch {
    qrBox.innerHTML = '';
    msgBox.textContent = 'Failed to generate a pairing code.';
  }
}

export function initDeviceHandlers() {
  const btn = el('btn-pair-device');
  if (!btn) return;
  btn.addEventListener('click', startPairing);
}
