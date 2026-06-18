/**
 * dashboard/upload.js — Media file upload queue and submission.
 */

import * as api from '../api.js';
import { el, esc } from '../utils.js';

// ── Module-local state ─────────────────────────────────────────────────────────
let uploadFiles = [];

// ── Injected callbacks ─────────────────────────────────────────────────────────
let _loadDashVaultStats = () => {};
let _loadDashLibrary    = () => {};
let _loadLibrary        = () => {};

export function init(callbacks = {}) {
  if (callbacks.loadDashVaultStats) _loadDashVaultStats = callbacks.loadDashVaultStats;
  if (callbacks.loadDashLibrary)    _loadDashLibrary    = callbacks.loadDashLibrary;
  if (callbacks.loadLibrary)        _loadLibrary        = callbacks.loadLibrary;
}

export function queueUploads(files) {
  uploadFiles = files;
  el('dash-upload-form').hidden = false;
  el('dash-upload-queue').innerHTML = files
    .map(f => `<div class="dash-file-item">• ${esc(f.name)} (${(f.size/1024/1024).toFixed(1)} MB)</div>`)
    .join('');
}

export function initUploadHandlers() {
  const uploadZone  = el('dash-upload-zone');
  const uploadInput = el('dash-upload-input');

  uploadZone.addEventListener('click',     () => uploadInput.click());
  uploadZone.addEventListener('dragover',  e  => { e.preventDefault(); uploadZone.classList.add('drag-over'); });
  uploadZone.addEventListener('dragleave', ()  => uploadZone.classList.remove('drag-over'));
  uploadZone.addEventListener('drop',      e  => {
    e.preventDefault();
    uploadZone.classList.remove('drag-over');
    queueUploads(Array.from(e.dataTransfer.files));
  });
  uploadInput.addEventListener('change', () => queueUploads(Array.from(uploadInput.files)));

  el('dash-upload-submit').addEventListener('click', async () => {
    const msg      = el('dash-upload-msg');
    const category = el('dash-upload-cat').value;
    const vis      = el('dash-upload-vis').value;
    msg.textContent = '';

    for (const file of uploadFiles) {
      const fd = new FormData();
      fd.append('category',   category);
      fd.append('visibility', vis);
      fd.append('media',      file);
      try {
        const res = await api.dashboard.media.upload(fd);
        if (!res.ok) throw new Error((await res.json()).error || 'Upload failed');
        msg.className   = 'dash-success-msg';
        msg.textContent = `Uploaded: ${file.name}`;
      } catch (err) {
        msg.className   = 'dash-error-msg';
        msg.textContent = err.message;
      }
    }
    uploadFiles = [];
    el('dash-upload-form').hidden = true;
    setTimeout(() => { _loadDashVaultStats(); _loadDashLibrary(); _loadLibrary(); }, 1500);
  });
}
