'use strict';

const form = document.getElementById('setup-form');
const stationNameInput = document.getElementById('stationName');
const slugInput = document.getElementById('slug');
const creatorFields = document.getElementById('creator-fields');
const vaultPathInput = document.getElementById('vaultPath');
const seedFileField = document.getElementById('seed-file-field');
const seedFilePathInput = document.getElementById('seedFilePath');
const seedFileError = document.getElementById('seed-file-error');
const errorEl = document.getElementById('setup-error');
const submitBtn = document.getElementById('submit-btn');
const stepperItems = document.querySelectorAll('.stepper li');
const stepEls = document.querySelectorAll('.step');

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
    const checked = document.querySelector('input[name="identityMode"]:checked');
    creatorFields.hidden = checked.value !== 'creator';
  });
}

document.getElementById('choose-vault-btn').addEventListener('click', async () => {
  const dir = await window.electronAPI.chooseVaultFolder();
  if (dir) vaultPathInput.value = dir;
});

// A public seed track is only required when imports start out Private —
// once Public is chosen, every import already plays on the broadcast.
function isSeedFileRequired() {
  return document.querySelector('input[name="initialVisibility"]:checked').value === 'vault';
}

for (const radio of document.querySelectorAll('input[name="initialVisibility"]')) {
  radio.addEventListener('change', () => {
    seedFileField.hidden = !isSeedFileRequired();
    seedFileError.hidden = true;
  });
}

document.getElementById('choose-seed-file-btn').addEventListener('click', async () => {
  const file = await window.electronAPI.chooseSeedFile();
  if (file) {
    seedFilePathInput.value = file;
    seedFileError.hidden = true;
  }
});

// ─── Step navigation ─────────────────────────────────────────────────────────

function showStep(step) {
  for (const el of stepEls) {
    el.hidden = Number(el.dataset.step) !== step;
  }
  for (const li of stepperItems) {
    const n = Number(li.dataset.step);
    li.classList.toggle('active', n === step);
    li.classList.toggle('completed', n < step);
  }
}

document.querySelectorAll('.next-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const currentStepEl = btn.closest('.step');
    const requiredInputs = currentStepEl.querySelectorAll('input[required]');
    for (const input of requiredInputs) {
      if (!input.reportValidity()) return;
    }
    if (currentStepEl.dataset.step === '2' && isSeedFileRequired() && !seedFilePathInput.value) {
      seedFileError.hidden = false;
      return;
    }
    showStep(Number(btn.dataset.next));
  });
});

document.querySelectorAll('.back-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    showStep(Number(btn.dataset.back));
  });
});

form.addEventListener('submit', async e => {
  e.preventDefault();
  errorEl.hidden = true;
  submitBtn.disabled = true;

  const identityMode = document.querySelector('input[name="identityMode"]:checked').value;
  const initialVisibility = document.querySelector('input[name="initialVisibility"]:checked').value;

  const formData = {
    stationName: stationNameInput.value,
    slug: slugInput.value,
    identityMode,
    creatorName: document.getElementById('creatorName').value,
    creatorDesc: document.getElementById('creatorDesc').value,
    vaultPath: vaultPathInput.value,
    vaultMode: document.getElementById('vaultMode').value,
    initialVisibility,
    seedFile: seedFilePathInput.value,
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

  document.getElementById('dashboard-token-display').value = result.dashboardToken;
  showStep(4);
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
