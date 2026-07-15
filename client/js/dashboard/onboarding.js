/**
 * dashboard/onboarding.js — One-time spotlight for the setup wizard's
 * required public seed track (see VAULT_SEED_PUBLIC_FILE / src/scanner/sync.js
 * seedPublicVisibility()). Shown once after launch, never again once dismissed.
 */

import * as api from '../api.js';

let _openVaultPanel = () => {};
let checked = false;

export function init(callbacks = {}) {
  if (callbacks.openVaultPanel) _openVaultPanel = callbacks.openVaultPanel;
}

export async function checkSeedTrackTour() {
  if (checked) return;
  checked = true;

  let data;
  try {
    data = await api.dashboard.onboardingSeed.get();
  } catch {
    return;
  }
  if (!data || data.tourSeen || !data.seedTrackId) return;

  showBanner(data.seedTrackId);
}

function dismiss() {
  api.dashboard.onboardingSeed.dismiss().catch(() => {});
  document.getElementById('onboarding-seed-banner')?.remove();
  document.getElementById('onboarding-seed-tooltip')?.remove();
  document.querySelectorAll('.onboarding-spotlight').forEach(row => row.classList.remove('onboarding-spotlight'));
}

function showBanner(seedTrackId) {
  const banner = document.createElement('div');
  banner.id = 'onboarding-seed-banner';
  banner.className = 'onboarding-banner';
  banner.innerHTML = `
    <span>Your broadcast has a starter track live — see it in the Vault.</span>
    <button type="button" class="mgmt-btn" id="onboarding-seed-show">Show me</button>
    <button type="button" class="onboarding-banner-close" id="onboarding-seed-close" aria-label="Dismiss">×</button>
  `;
  document.body.appendChild(banner);

  banner.querySelector('#onboarding-seed-close').addEventListener('click', dismiss);
  banner.querySelector('#onboarding-seed-show').addEventListener('click', () => {
    banner.remove();
    spotlightTrack(seedTrackId);
  });
}

// buildDashLibItem rows are keyed by track id (#vis-${id}), but the library
// list re-renders asynchronously after opening the panel — poll briefly
// rather than assume it's already in the DOM.
function waitForRow(seedTrackId, attemptsLeft = 20) {
  return new Promise(resolve => {
    (function tryFind() {
      const row = document.getElementById(`vis-${seedTrackId}`)?.closest('.mgmt-row');
      if (row) return resolve(row);
      if (attemptsLeft-- <= 0) return resolve(null);
      setTimeout(tryFind, 150);
    })();
  });
}

async function spotlightTrack(seedTrackId) {
  const panel = document.getElementById('vault-panel-tracks');
  if (panel && panel.hidden) _openVaultPanel('tracks');

  const row = await waitForRow(seedTrackId);
  if (!row) { dismiss(); return; }

  row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  row.style.position = 'relative';
  row.classList.add('onboarding-spotlight');

  const tooltip = document.createElement('div');
  tooltip.id = 'onboarding-seed-tooltip';
  tooltip.className = 'onboarding-tooltip';
  tooltip.innerHTML = `
    <p>This track is <strong>Public</strong> so your broadcast has something to play right away. Keep it, swap in a different first track, or publish more of your library — your call.</p>
    <button type="button" class="mgmt-btn" id="onboarding-seed-gotit">Got it</button>
  `;
  row.appendChild(tooltip);

  tooltip.querySelector('#onboarding-seed-gotit').addEventListener('click', dismiss);
}
