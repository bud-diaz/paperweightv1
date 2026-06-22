/**
 * dashboard/sections.js — wraps each top-level Studio dashboard section in a
 * collapsible, drag-to-reorder card. Order and collapsed state persist in
 * localStorage per browser.
 */

import { el } from '../utils.js';

const STORAGE_ORDER     = 'pw_dash_section_order';
const STORAGE_COLLAPSED = 'pw_dash_section_collapsed';

function readJSON(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return Array.isArray(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

function slug(text) {
  return String(text || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function sectionTitle(section, index) {
  const labelHost = section.querySelector('.dash-section-label');
  const text = labelHost ? labelHost.textContent.trim() : '';
  return text || `Section ${index + 1}`;
}

function buildCard(section, index) {
  const title = sectionTitle(section, index);
  const key = section.id || slug(title) || `dash-section-${index}`;

  const card = document.createElement('div');
  card.className = 'dash-card';
  card.dataset.sectionKey = key;
  if (section.hasAttribute('data-desktop-only')) card.setAttribute('data-desktop-only', '');

  const head = document.createElement('div');
  head.className = 'dash-card-head';

  const handle = document.createElement('span');
  handle.className = 'dash-drag-handle';
  handle.setAttribute('aria-hidden', 'true');
  handle.textContent = '⠿';

  const titleEl = document.createElement('span');
  titleEl.className = 'dash-card-title';
  titleEl.textContent = title;

  const collapseBtn = document.createElement('button');
  collapseBtn.type = 'button';
  collapseBtn.className = 'dash-card-collapse-btn';
  collapseBtn.setAttribute('aria-label', `Collapse ${title} section`);
  collapseBtn.textContent = '▾';

  head.appendChild(handle);
  head.appendChild(titleEl);
  head.appendChild(collapseBtn);

  const body = document.createElement('div');
  body.className = 'dash-card-body';
  body.appendChild(section);

  card.appendChild(head);
  card.appendChild(body);
  return card;
}

function saveOrder(container) {
  const order = [...container.querySelectorAll(':scope > .dash-card')].map(c => c.dataset.sectionKey);
  localStorage.setItem(STORAGE_ORDER, JSON.stringify(order));
}

function saveCollapsed(container) {
  const collapsed = [...container.querySelectorAll(':scope > .dash-card.collapsed')].map(c => c.dataset.sectionKey);
  localStorage.setItem(STORAGE_COLLAPSED, JSON.stringify(collapsed));
}

function applyStoredOrder(container) {
  const order = readJSON(STORAGE_ORDER, null);
  if (!order) return;
  const byKey = new Map([...container.querySelectorAll(':scope > .dash-card')].map(c => [c.dataset.sectionKey, c]));
  order.forEach(key => {
    const card = byKey.get(key);
    if (card) container.appendChild(card);
  });
}

function applyStoredCollapsed(container) {
  const collapsed = readJSON(STORAGE_COLLAPSED, []);
  collapsed.forEach(key => {
    const card = container.querySelector(`:scope > .dash-card[data-section-key="${key}"]`);
    if (card) card.classList.add('collapsed');
  });
}

function wireCollapseButtons(container) {
  container.querySelectorAll(':scope > .dash-card').forEach(card => {
    card.querySelector('.dash-card-collapse-btn').addEventListener('click', () => {
      card.classList.toggle('collapsed');
      saveCollapsed(container);
    });
  });
}

function resetLayout(container, defaultOrder) {
  localStorage.removeItem(STORAGE_ORDER);
  localStorage.removeItem(STORAGE_COLLAPSED);
  const byKey = new Map([...container.querySelectorAll(':scope > .dash-card')].map(c => [c.dataset.sectionKey, c]));
  defaultOrder.forEach(key => {
    const card = byKey.get(key);
    if (card) {
      card.classList.remove('collapsed');
      container.appendChild(card);
    }
  });
}

function buildToolbar(container, defaultOrder) {
  const bar = document.createElement('div');
  bar.className = 'dash-sections-toolbar';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'dash-sections-reset-btn';
  btn.textContent = 'RESET LAYOUT';
  btn.addEventListener('click', () => resetLayout(container, defaultOrder));

  bar.appendChild(btn);
  return bar;
}

function wireDragReorder(container) {
  let dragCard = null;

  function onPointerMove(e) {
    if (!dragCard) return;
    const siblings = [...container.querySelectorAll(':scope > .dash-card')].filter(c => c !== dragCard);
    for (const sib of siblings) {
      const rect = sib.getBoundingClientRect();
      if (e.clientY < rect.top || e.clientY > rect.bottom) continue;
      const before = e.clientY < rect.top + rect.height / 2;
      container.insertBefore(dragCard, before ? sib : sib.nextSibling);
      break;
    }
  }

  function onPointerUp() {
    if (!dragCard) return;
    dragCard.classList.remove('dragging');
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
    saveOrder(container);
    dragCard = null;
  }

  container.querySelectorAll(':scope > .dash-card').forEach(card => {
    const head = card.querySelector('.dash-card-head');
    head.addEventListener('pointerdown', e => {
      if (e.target.closest('.dash-card-collapse-btn')) return;
      e.preventDefault();
      dragCard = card;
      card.classList.add('dragging');
      document.addEventListener('pointermove', onPointerMove);
      document.addEventListener('pointerup', onPointerUp);
    });
  });
}

export function init() {
  const content = el('dash-content');
  if (!content || content.dataset.cardsBuilt) return;
  content.dataset.cardsBuilt = '1';

  const sections = [...content.querySelectorAll(':scope > .dash-section')];
  if (!sections.length) return;

  const container = document.createElement('div');
  container.id = 'dash-sections';
  sections[0].parentNode.insertBefore(container, sections[0]);

  const cards = sections.map((section, i) => buildCard(section, i));
  cards.forEach(card => container.appendChild(card));
  content.querySelectorAll(':scope > .dash-divider').forEach(d => d.remove());

  const defaultOrder = cards.map(c => c.dataset.sectionKey);
  container.parentNode.insertBefore(buildToolbar(container, defaultOrder), container);

  applyStoredOrder(container);
  applyStoredCollapsed(container);
  wireCollapseButtons(container);
  wireDragReorder(container);
}
