/**
 * dashboard/sections.js — wraps each top-level Studio dashboard section in a
 * tap-to-reveal, drag-to-reorder card. At most MAX_OPEN cards can be open at
 * once (opening another auto-closes the least-recently-opened one). Order
 * and open state persist in localStorage per browser.
 */

import { el } from '../utils.js';

const STORAGE_ORDER = 'pw_dash_section_order';
const STORAGE_OPEN  = 'pw_dash_section_open';
const MAX_OPEN = 3;
const DEFAULT_OPEN = ['vault'];

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

  const chevron = document.createElement('span');
  chevron.className = 'dash-card-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.textContent = '▾';

  head.setAttribute('role', 'button');
  head.setAttribute('tabindex', '0');
  head.setAttribute('aria-label', `Expand ${title} section`);

  head.appendChild(chevron);
  head.appendChild(titleEl);
  head.appendChild(handle);

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

function saveOpen(openOrder) {
  localStorage.setItem(STORAGE_OPEN, JSON.stringify(openOrder));
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

// Drives the open/close height animation. Cards default to `height: 0` in
// CSS; opening measures the natural content height and animates to it, then
// releases to `height: auto` once settled so nested content (e.g. the
// schedule/analytics sub-accordions) can keep growing without being clipped.
function setCardOpen(card, isOpen, { animate = true } = {}) {
  const body = card.querySelector('.dash-card-body');
  const title = card.querySelector('.dash-card-title').textContent;
  card.classList.toggle('open', isOpen);
  card.querySelector('.dash-card-head')
    .setAttribute('aria-label', `${isOpen ? 'Collapse' : 'Expand'} ${title} section`);

  if (!animate) {
    body.style.height = isOpen ? 'auto' : '0px';
    return;
  }

  if (isOpen) {
    const target = body.scrollHeight;
    body.style.height = '0px';
    requestAnimationFrame(() => { body.style.height = `${target}px`; });
    body.addEventListener('transitionend', function onEnd(e) {
      if (e.propertyName !== 'height') return;
      body.removeEventListener('transitionend', onEnd);
      if (card.classList.contains('open')) body.style.height = 'auto';
    });
  } else {
    body.style.height = `${body.scrollHeight}px`;
    requestAnimationFrame(() => { body.style.height = '0px'; });
  }
}

function applyStoredOpen(container, openOrder) {
  openOrder.forEach(key => {
    const card = container.querySelector(`:scope > .dash-card[data-section-key="${key}"]`);
    if (card) setCardOpen(card, true, { animate: false });
  });
}

function wireToggleButtons(container, openOrder) {
  function toggle(card) {
    const key = card.dataset.sectionKey;
    const isOpen = card.classList.contains('open');

    if (isOpen) {
      setCardOpen(card, false);
      const idx = openOrder.indexOf(key);
      if (idx !== -1) openOrder.splice(idx, 1);
    } else {
      while (openOrder.length >= MAX_OPEN) {
        const oldestKey = openOrder.shift();
        const oldestCard = container.querySelector(`:scope > .dash-card[data-section-key="${oldestKey}"]`);
        if (oldestCard) setCardOpen(oldestCard, false);
      }
      setCardOpen(card, true);
      openOrder.push(key);
    }

    saveOpen(openOrder);
  }

  container.querySelectorAll(':scope > .dash-card').forEach(card => {
    const head = card.querySelector('.dash-card-head');
    head.addEventListener('click', e => {
      if (e.target.closest('.dash-drag-handle')) return;
      toggle(card);
    });
    head.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      toggle(card);
    });
  });
}

function resetLayout(container, defaultOrder, openOrder) {
  localStorage.removeItem(STORAGE_ORDER);
  localStorage.removeItem(STORAGE_OPEN);
  openOrder.length = 0;
  const byKey = new Map([...container.querySelectorAll(':scope > .dash-card')].map(c => [c.dataset.sectionKey, c]));
  defaultOrder.forEach(key => {
    const card = byKey.get(key);
    if (card) {
      setCardOpen(card, DEFAULT_OPEN.includes(key), { animate: false });
      container.appendChild(card);
    }
  });
  openOrder.push(...DEFAULT_OPEN);
  saveOpen(openOrder);
}

function buildToolbar(container, defaultOrder, openOrder) {
  const bar = document.createElement('div');
  bar.className = 'dash-sections-toolbar';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'dash-sections-reset-btn';
  btn.textContent = 'RESET LAYOUT';
  btn.addEventListener('click', () => resetLayout(container, defaultOrder, openOrder));

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
    const handle = card.querySelector('.dash-drag-handle');
    handle.addEventListener('pointerdown', e => {
      e.preventDefault();
      e.stopPropagation();
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
  const openOrder = readJSON(STORAGE_OPEN, DEFAULT_OPEN).slice(0, MAX_OPEN);
  container.parentNode.insertBefore(buildToolbar(container, defaultOrder, openOrder), container);

  applyStoredOrder(container);
  applyStoredOpen(container, openOrder);
  wireToggleButtons(container, openOrder);
  wireDragReorder(container);
}
