/**
 * docs.js — creator-mode "Docs" modal: a list-to-detail viewer for README,
 * licensing, content-responsibility, and per-platform/Cloudflare setup docs.
 * Reachable only from the settings-gear dropdown while in creator-mode (see
 * settings.js, which swaps that dropdown item to DOCS for creators).
 *
 * Two entries (the Paperweight license and content-responsibility notice)
 * already have hand-formatted HTML pages served at /landing/license and
 * /landing/content-responsibility, so those render via <iframe>. The rest
 * come from GET /api/docs (client/js/api.js's `docs` namespace) as plain
 * Markdown/text, rendered client-side with markdown.js.
 */

import { el } from './utils.js';
import * as api from './api.js';
import { renderMarkdown } from './markdown.js';

const LEGAL_DOCS = {
  'license-paperweight':   { title: 'Paperweight License',   kind: 'iframe', src: '/landing/license' },
  'content-responsibility': { title: 'Content Responsibility', kind: 'iframe', src: '/landing/content-responsibility' },
};

// Display order: README, then the two licenses side by side, then content
// responsibility, then the four setup guides.
const ORDER = [
  'readme',
  'license-paperweight',
  'asciline-notice',
  'content-responsibility',
  'setup-windows',
  'setup-macos',
  'setup-linux-pi',
  'setup-cloudflare',
];

let _docs = null;
let _activeId = null;

async function loadDocs() {
  if (_docs) return _docs;
  const { docs } = await api.docs.list();
  const byId = { ...LEGAL_DOCS };
  for (const d of docs) byId[d.id] = { title: d.title, kind: 'markdown' };
  _docs = ORDER.filter(id => byId[id]).map(id => ({ id, ...byId[id] }));
  return _docs;
}

function renderList() {
  const listEl = el('docs-modal-list');
  listEl.innerHTML = '';
  for (const doc of _docs) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'docs-list-item';
    btn.textContent = doc.title;
    btn.dataset.docId = doc.id;
    btn.addEventListener('click', () => selectDoc(doc.id));
    listEl.appendChild(btn);
  }
}

async function selectDoc(id) {
  _activeId = id;
  el('docs-modal-list').querySelectorAll('.docs-list-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.docId === id);
  });

  const doc = _docs.find(d => d.id === id);
  const contentEl = el('docs-modal-content');
  if (!doc) return;

  if (doc.kind === 'iframe') {
    contentEl.innerHTML = `<iframe src="${doc.src}" title="${doc.title}"></iframe>`;
    return;
  }

  contentEl.innerHTML = '<p class="docs-loading">Loading…</p>';
  try {
    const text = await api.docs.get(id);
    if (_activeId !== id) return; // a later selection has since taken over
    contentEl.innerHTML = renderMarkdown(text);
  } catch {
    if (_activeId !== id) return;
    contentEl.innerHTML = '<p class="docs-loading">Couldn’t load this document.</p>';
  }
}

export async function openDocsModal() {
  el('docs-modal-backdrop').classList.add('open');
  await loadDocs();
  renderList();
  selectDoc(_activeId && _docs.some(d => d.id === _activeId) ? _activeId : _docs[0].id);
}

export function closeDocsModal() {
  el('docs-modal-backdrop').classList.remove('open');
}

export function initDocsModalHandlers() {
  el('docs-modal-close').addEventListener('click', closeDocsModal);
  el('docs-modal-backdrop').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeDocsModal();
  });
}
