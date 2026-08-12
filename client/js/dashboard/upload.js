/**
 * dashboard/upload.js — Media file upload queue and submission.
 */

import * as api from '../api.js';
import { el, esc } from '../utils.js';

// ── Module-local state ─────────────────────────────────────────────────────────
let uploadFiles = [];
let uploadCollections = [];

// ── Injected callbacks ─────────────────────────────────────────────────────────
let _loadDashVaultStats = () => {};
let _loadDashLibrary    = () => {};
let _loadLibrary        = () => {};
let _loadDashProjects   = () => {};

export function init(callbacks = {}) {
  if (callbacks.loadDashVaultStats) _loadDashVaultStats = callbacks.loadDashVaultStats;
  if (callbacks.loadDashLibrary)    _loadDashLibrary    = callbacks.loadDashLibrary;
  if (callbacks.loadLibrary)        _loadLibrary        = callbacks.loadLibrary;
  if (callbacks.loadDashProjects)   _loadDashProjects   = callbacks.loadDashProjects;
}

async function loadUploadCollections() {
  const select = el('dash-upload-collection-existing');
  select.innerHTML = '<option value="">Loading Collections...</option>';
  try {
    const pricing = await api.dashboard.vault.pricing();
    const projects = pricing.projects || [];
    uploadCollections = projects;
    select.innerHTML = projects.length
      ? '<option value="">Choose Collection</option>' + projects
        .map(p => `<option value="${p.id}">${esc(p.name)}</option>`)
        .join('')
      : '<option value="">No Collections Yet</option>';
  } catch {
    uploadCollections = [];
    select.innerHTML = '<option value="">Collections Unavailable</option>';
  }
}

function syncUploadCollectionControls() {
  const mode = el('dash-upload-collection-mode').value;
  el('dash-upload-collection-existing').hidden = mode !== 'existing';
  el('dash-upload-collection-name').hidden = mode !== 'new';
  if (mode === 'existing') loadUploadCollections();
}

function defaultCollectionName(files) {
  if (files.length === 1) return files[0].name.replace(/\.[^.]+$/, '').trim() || 'New Collection';
  return 'New Collection';
}

export function queueUploads(files) {
  uploadFiles = files;
  el('dash-upload-form').hidden = false;
  el('dash-upload-queue').innerHTML = files
    .map(f => `<div class="dash-file-item">• ${esc(f.name)} (${(f.size/1024/1024).toFixed(1)} MB)</div>`)
    .join('');
  if (!el('dash-upload-collection-name').value.trim()) {
    el('dash-upload-collection-name').value = defaultCollectionName(files);
  }
}

export function initUploadHandlers() {
  const uploadZone  = el('dash-upload-zone');
  const uploadInput = el('dash-upload-input');
  el('dash-upload-collection-mode').addEventListener('change', syncUploadCollectionControls);

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
    const collectionMode = el('dash-upload-collection-mode').value;
    const uploadTitle = el('dash-upload-title').value.trim();
    const uploadArtist = el('dash-upload-artist').value.trim();
    let collectionName = null;
    let collectionId = collectionMode === 'existing'
      ? parseInt(el('dash-upload-collection-existing').value, 10)
      : null;
    msg.textContent = '';

    if (collectionMode === 'existing' && !collectionId) {
      msg.className = 'dash-error-msg';
      msg.textContent = 'Choose a collection';
      return;
    }
    if (collectionMode === 'existing') {
      const selected = uploadCollections.find(p => p.id === collectionId);
      collectionName = selected?.name || el('dash-upload-collection-existing').selectedOptions[0]?.textContent?.trim() || null;
    }
    if (collectionMode === 'new') {
      const name = el('dash-upload-collection-name').value.trim();
      if (!name) {
        msg.className = 'dash-error-msg';
        msg.textContent = 'Collection name required';
        return;
      }
      const { res, data } = await api.dashboard.vault.createCollection({
        name,
        description: null,
        cover_art_path: null,
        suggested_price: 0,
        minimum_price: 0,
        allow_free: true,
        payment_type: 'one_time',
      });
      if (!res.ok) {
        msg.className = 'dash-error-msg';
        msg.textContent = data.error || 'Could not create collection';
        return;
      }
      collectionId = data.id;
      collectionName = name;
    }

    for (const file of uploadFiles) {
      const fd = new FormData();
      fd.append('category',   category);
      fd.append('visibility', vis);
      if (uploadTitle) fd.append('title', uploadTitle);
      if (uploadArtist) fd.append('artist', uploadArtist);
      if (collectionId && collectionName) fd.append('album', collectionName);
      fd.append('media',      file);
      try {
        const res = await api.dashboard.media.upload(fd);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Upload failed');
        if (collectionId && data.id) {
          const { res: addRes, data: addData } = await api.dashboard.vault.addCollectionTrack(collectionId, {
            content_id: data.id,
          });
          if (!addRes.ok && addRes.status !== 409) throw new Error(addData.error || 'Uploaded, but collection add failed');
        }
        msg.className   = 'dash-success-msg';
        msg.textContent = `Uploaded: ${file.name}`;
      } catch (err) {
        msg.className   = 'dash-error-msg';
        msg.textContent = err.message;
      }
    }
    uploadFiles = [];
    el('dash-upload-form').hidden = true;
    el('dash-upload-collection-name').value = '';
    el('dash-upload-title').value = '';
    el('dash-upload-artist').value = '';
    setTimeout(() => { _loadDashVaultStats(); _loadDashLibrary(); _loadDashProjects(); _loadLibrary(); }, 1500);
  });

  syncUploadCollectionControls();
}
