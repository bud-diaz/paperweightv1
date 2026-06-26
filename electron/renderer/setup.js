'use strict';

const form = document.getElementById('setup-form');
const stationNameInput = document.getElementById('stationName');
const slugInput = document.getElementById('slug');
const creatorFields = document.getElementById('creator-fields');
const vaultPathInput = document.getElementById('vaultPath');
const errorEl = document.getElementById('setup-error');
const submitBtn = document.getElementById('submit-btn');

let slugTouched = false;
slugInput.addEventListener('input', () => { slugTouched = true; });

stationNameInput.addEventListener('input', () => {
  if (slugTouched) return;
  slugInput.value = stationNameInput.value
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
});

for (const radio of document.querySelectorAll('input[name="identityMode"]')) {
  radio.addEventListener('change', () => {
    creatorFields.hidden = radio.value !== 'creator' || !radio.checked;
    const checked = document.querySelector('input[name="identityMode"]:checked');
    creatorFields.hidden = checked.value !== 'creator';
  });
}

document.getElementById('choose-vault-btn').addEventListener('click', async () => {
  const dir = await window.electronAPI.chooseVaultFolder();
  if (dir) vaultPathInput.value = dir;
});

form.addEventListener('submit', async e => {
  e.preventDefault();
  errorEl.hidden = true;
  submitBtn.disabled = true;

  const identityMode = document.querySelector('input[name="identityMode"]:checked').value;

  const formData = {
    stationName: stationNameInput.value,
    slug: slugInput.value,
    identityMode,
    creatorName: document.getElementById('creatorName').value,
    creatorDesc: document.getElementById('creatorDesc').value,
    vaultPath: vaultPathInput.value,
    vaultMode: document.getElementById('vaultMode').value,
    cfTunnelToken: document.getElementById('cfTunnelToken').value,
    publicUrl: document.getElementById('publicUrl').value,
  };

  const result = await window.electronAPI.submitSetup(formData);

  if (!result.ok) {
    errorEl.textContent = result.error || 'Setup failed.';
    errorEl.hidden = false;
    submitBtn.disabled = false;
    return;
  }

  form.hidden = true;
  document.getElementById('dashboard-token-display').value = result.dashboardToken;
  document.getElementById('done-screen').hidden = false;
});

document.getElementById('copy-token-btn').addEventListener('click', () => {
  const input = document.getElementById('dashboard-token-display');
  input.select();
  document.execCommand('copy');
});

document.getElementById('launch-btn').addEventListener('click', async () => {
  document.getElementById('launch-btn').disabled = true;
  document.getElementById('launch-btn').textContent = 'Launching…';
  await window.electronAPI.closeSetup();
});
