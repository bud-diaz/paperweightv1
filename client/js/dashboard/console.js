/**
 * dashboard/console.js — mission-control layout, flip-card state, and compact
 * status readouts. Existing dashboard sections and IDs are moved, never cloned.
 */

import { el, esc } from '../utils.js';
import { openGoLiveModal } from './golive.js';

const OPEN_STORAGE = 'pw_dash_section_open';
const ORDER_STORAGE = 'pw_dash_card_order';
const MAX_OPEN = 3;
const DEFAULT_OPEN = ['vault'];
const CLOSED_HEIGHT = 78;
const MAX_OPEN_HEIGHT = 520;

let cards = [];
let openOrder = [];
let earningsPayload = null;
let earningsPeriod = 'today';
let resizeObserver = null;

function readOpenState() {
  try {
    const value = JSON.parse(localStorage.getItem(OPEN_STORAGE));
    return Array.isArray(value) ? value.slice(0, MAX_OPEN) : [...DEFAULT_OPEN];
  } catch {
    return [...DEFAULT_OPEN];
  }
}

function saveOpenState() {
  localStorage.setItem(OPEN_STORAGE, JSON.stringify(openOrder));
}

function readCardOrder() {
  try {
    const value = JSON.parse(localStorage.getItem(ORDER_STORAGE));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function saveCardOrder() {
  localStorage.setItem(ORDER_STORAGE, JSON.stringify(cards.map(card => card.dataset.sectionKey)));
}

function sectionLabel(section) {
  return section?.querySelector('.dash-section-label')?.textContent.trim().toUpperCase() || '';
}

function statusCell(label, key, { button = false } = {}) {
  const node = document.createElement(button ? 'button' : 'div');
  node.className = `console-status-cell${button ? ' console-status-button' : ''}`;
  node.dataset.consoleStatusCell = key;
  if (button) node.type = 'button';
  node.innerHTML = `
    <span class="console-status-label">${esc(label)}</span>
    <span class="console-status-value" data-console-status="${esc(key)}">—</span>
    <span class="console-status-sub" data-console-status-sub="${esc(key)}"></span>`;
  return node;
}

function createStatusStrip() {
  const strip = document.createElement('div');
  strip.className = 'console-status-strip';
  strip.setAttribute('aria-label', 'Station status');
  strip.append(
    statusCell('Broadcast', 'broadcast', { button: true }),
    statusCell('Listeners', 'listeners'),
    statusCell('Station Health', 'health'),
    statusCell('Schedule', 'schedule'),
    statusCell('Queue', 'queue'),
    statusCell('Today', 'earnings', { button: true }),
  );
  const broadcastButton = strip.querySelector('[data-console-status-cell="broadcast"]');
  broadcastButton.setAttribute('aria-label', 'Open Go Live');
  broadcastButton.addEventListener('click', () => openGoLiveModal());
  const earningsButton = strip.querySelector('[data-console-status-cell="earnings"]');
  earningsButton.setAttribute('aria-label', 'Show lifetime earnings');
  earningsButton.addEventListener('click', toggleEarningsPeriod);
  return strip;
}

function createCard({ key, label, shortLabel = label, span, nodes = [], desktopOnly = false }) {
  const card = document.createElement('article');
  card.className = `console-card console-span-${span}`;
  card.dataset.sectionKey = key;
  card.style.height = `${CLOSED_HEIGHT}px`;
  if (desktopOnly) card.setAttribute('data-desktop-only', '');

  const inner = document.createElement('div');
  inner.className = 'console-card-inner';

  const front = document.createElement('div');
  front.className = 'console-card-front';
  front.innerHTML = `
    <button type="button" class="console-card-open" aria-expanded="false">
      <span class="console-card-cue" aria-hidden="true"></span>
      <span class="console-card-short">${esc(shortLabel)}</span>
      <span class="console-card-open-hint">OPEN ↗</span>
    </button>
    <button type="button" class="console-card-reorder console-card-reorder-front" draggable="true"
      aria-label="Rearrange ${esc(label)}; drag, tap either chevron, or use arrow keys"
      title="Drag or tap a chevron to rearrange">
      <span aria-hidden="true"></span>
    </button>`;

  const back = document.createElement('div');
  back.className = 'console-card-back';
  back.setAttribute('aria-hidden', 'true');
  back.innerHTML = `
    <div class="console-card-head">
      <button type="button" class="console-card-dismiss" aria-label="Close ${esc(label)}">
        <span class="console-card-title">${esc(label)}</span>
        ${key === 'earnings' ? '<span class="console-card-period" data-console-earnings-period>TODAY</span>' : ''}
      </button>
      <button type="button" class="console-card-reorder" draggable="true"
        aria-label="Rearrange ${esc(label)}; drag, tap either chevron, or use arrow keys"
        title="Drag or tap a chevron to rearrange">
        <span aria-hidden="true"></span>
      </button>
    </div>
    <div class="console-card-content"></div>`;
  const content = back.querySelector('.console-card-content');
  nodes.filter(Boolean).forEach(node => content.appendChild(node));

  front.querySelector('.console-card-open').addEventListener('click', () => openCard(card));
  const dismiss = back.querySelector('.console-card-dismiss');
  dismiss.addEventListener('click', () => closeCard(card));
  [...front.querySelectorAll('.console-card-reorder'), ...back.querySelectorAll('.console-card-reorder')].forEach(reorder => {
    reorder.addEventListener('click', event => {
      event.stopPropagation();
      const rect = reorder.getBoundingClientRect();
      moveCard(card, event.clientY < rect.top + rect.height / 2 ? -1 : 1, reorder);
    });
  });
  inner.append(front, back);
  card.appendChild(inner);
  return card;
}

function cardHeight(card) {
  const back = card.querySelector('.console-card-back');
  return Math.min(MAX_OPEN_HEIGHT, Math.max(190, back.scrollHeight + 2));
}

function applyCardState(card, isOpen, { persist = true } = {}) {
  const key = card.dataset.sectionKey;
  card.classList.toggle('is-open', isOpen);
  card.querySelector('.console-card-open').setAttribute('aria-expanded', String(isOpen));
  card.querySelector('.console-card-back').setAttribute('aria-hidden', String(!isOpen));
  card.style.height = `${isOpen ? cardHeight(card) : CLOSED_HEIGHT}px`;

  const index = openOrder.indexOf(key);
  if (isOpen && index === -1) openOrder.push(key);
  if (!isOpen && index !== -1) openOrder.splice(index, 1);
  if (persist) saveOpenState();
}

function openCard(card) {
  const key = card.dataset.sectionKey;
  if (openOrder.includes(key)) return;
  while (openOrder.length >= MAX_OPEN) {
    const oldest = openOrder[0];
    const oldestCard = cards.find(item => item.dataset.sectionKey === oldest);
    if (oldestCard) applyCardState(oldestCard, false, { persist: false });
    else openOrder.shift();
  }
  applyCardState(card, true);
}

function closeCard(card) {
  applyCardState(card, false);
}

function moveCard(card, direction, focusTarget = null) {
  const index = cards.indexOf(card);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= cards.length) return;
  const other = cards[nextIndex];
  const grid = card.parentElement;
  if (direction < 0) grid.insertBefore(card, other);
  else grid.insertBefore(other, card);
  cards = [...grid.querySelectorAll(':scope > .console-card')];
  saveCardOrder();
  focusTarget?.focus();
}

function setupCardReordering(grid) {
  let draggedCard = null;

  cards.forEach(card => {
    card.querySelectorAll('.console-card-reorder').forEach(handle => {
      handle.addEventListener('keydown', event => {
        if (!['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight'].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        moveCard(card, ['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : 1, handle);
      });
      handle.addEventListener('dragstart', event => {
        draggedCard = card;
        card.classList.add('is-reordering');
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', card.dataset.sectionKey);
      });
      handle.addEventListener('dragend', () => {
        card.classList.remove('is-reordering');
        draggedCard = null;
        cards = [...grid.querySelectorAll(':scope > .console-card')];
        saveCardOrder();
      });
    });
  });

  grid.addEventListener('dragover', event => {
    if (!draggedCard) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const target = event.target.closest('.console-card');
    if (!target || target === draggedCard) return;
    const rect = target.getBoundingClientRect();
    const after = event.clientY > rect.top + rect.height / 2 ||
      (Math.abs(event.clientY - (rect.top + rect.height / 2)) < rect.height / 3 &&
        event.clientX > rect.left + rect.width / 2);
    grid.insertBefore(draggedCard, after ? target.nextSibling : target);
  });

  grid.addEventListener('drop', event => {
    if (!draggedCard) return;
    event.preventDefault();
    cards = [...grid.querySelectorAll(':scope > .console-card')];
    saveCardOrder();
  });
}

function moveAnalyticsTopList(analyticsSection) {
  const topList = el('analytics-top-list');
  const topHeading = analyticsSection?.querySelector('.analytics-top-heading');
  const section = document.createElement('div');
  section.className = 'dash-section console-top-tracks-section';
  if (topHeading) section.appendChild(topHeading);
  if (topList) section.appendChild(topList);
  return section;
}

function buildLayout(content) {
  const directSections = [...content.querySelectorAll(':scope > .dash-section')];
  const byLabel = new Map(directSections.map(section => [sectionLabel(section), section]));
  const take = label => {
    const section = byLabel.get(label);
    if (section) byLabel.delete(label);
    return section;
  };

  const station = take('STATION');
  const vault = take('VAULT');
  const collections = take('COLLECTIONS');
  const posts = take('POSTS');
  const analytics = take('ANALYTICS');
  const topTracks = moveAnalyticsTopList(analytics);
  const broadcast = take('BROADCAST');
  const liveVideo = take('LIVE VIDEO');
  const schedule = take('SCHEDULE');
  const upload = take('UPLOAD');
  const externalSearch = take('SEARCH & ADD CONTENT');
  const security = take('SECURITY');
  const devices = take('AUTHORIZED DEVICES');
  const payments = take('PAYMENTS');
  const earnings = take('EARNINGS');

  const radioHostToggle = el('broadcast-header-toggle');
  const radioHostControls = el('broadcast-advanced');
  if (liveVideo) {
    [radioHostToggle, radioHostControls].filter(Boolean).forEach(node => liveVideo.appendChild(node));
  }

  const paymentStatus = el('dash-payment-status');
  if (paymentStatus) {
    const serviceStatus = document.createElement('div');
    serviceStatus.className = 'console-service-status';
    serviceStatus.innerHTML = '<div class="dash-edit-label">PAYMENT SERVICES</div>';
    serviceStatus.appendChild(paymentStatus);
    station?.appendChild(serviceStatus);
  }

  el('analytics-details')?.setAttribute('open', '');
  el('earnings-details')?.setAttribute('open', '');

  const runtimeAlert = el('dash-runtime-alert');
  const moreSettings = [...byLabel.values(), payments].filter(Boolean);
  const definitions = [
    { key: 'broadcast', label: 'Broadcast Control', shortLabel: 'BROADCAST', span: 7, nodes: [broadcast] },
    { key: 'live-video', label: 'Live Broadcast', shortLabel: 'LIVE', span: 5, nodes: [liveVideo] },
    { key: 'schedule', label: 'Schedule', shortLabel: 'SCHEDULE', span: 8, nodes: [schedule] },
    { key: 'system', label: 'System Health', shortLabel: 'SYSTEM', span: 4, nodes: [runtimeAlert, station] },
    { key: 'vault', label: 'Vault', shortLabel: 'VAULT', span: 4, nodes: [vault, collections, upload] },
    { key: 'earnings', label: 'Earnings', shortLabel: 'EARNINGS', span: 4, nodes: [earnings] },
    { key: 'analytics', label: 'Analytics', shortLabel: 'ANALYTICS', span: 6, nodes: [analytics] },
    { key: 'top-tracks', label: 'Top Tracks', shortLabel: 'TOP TRACKS', span: 6, nodes: [topTracks] },
    { key: 'posts', label: 'Posts', shortLabel: 'POSTS', span: 4, nodes: [posts] },
    { key: 'security', label: 'Security & Devices', shortLabel: 'SECURITY', span: 4, nodes: [security, devices] },
    { key: 'dash-ext-search-section', label: 'Search & Add Content', shortLabel: 'SEARCH + ADD', span: 12, nodes: [externalSearch], desktopOnly: true },
    { key: 'more-settings', label: 'More Settings', shortLabel: 'MORE', span: 12, nodes: moreSettings },
  ];

  content.querySelectorAll(':scope > .dash-divider').forEach(node => node.remove());

  const consoleRoot = document.createElement('div');
  consoleRoot.className = 'studio-console';
  const strip = createStatusStrip();
  const grid = document.createElement('div');
  grid.className = 'console-grid';
  cards = definitions
    .filter(definition => definition.nodes.some(Boolean))
    .map(createCard);
  const savedOrder = readCardOrder();
  cards.sort((a, b) => {
    const aIndex = savedOrder.indexOf(a.dataset.sectionKey);
    const bIndex = savedOrder.indexOf(b.dataset.sectionKey);
    return (aIndex < 0 ? Number.MAX_SAFE_INTEGER : aIndex) -
      (bIndex < 0 ? Number.MAX_SAFE_INTEGER : bIndex);
  });
  cards.forEach(card => grid.appendChild(card));
  setupCardReordering(grid);
  consoleRoot.append(strip, grid);
  content.appendChild(consoleRoot);

  openOrder = readOpenState().filter(key => cards.some(card => card.dataset.sectionKey === key));
  if (!localStorage.getItem(OPEN_STORAGE)) openOrder = [...DEFAULT_OPEN];
  cards.forEach(card => applyCardState(card, openOrder.includes(card.dataset.sectionKey), { persist: false }));
  saveOpenState();
  saveCardOrder();

  resizeObserver = new ResizeObserver(entries => {
    entries.forEach(({ target }) => {
      const card = target.closest('.console-card');
      if (card?.classList.contains('is-open')) card.style.height = `${cardHeight(card)}px`;
    });
  });
  cards.forEach(card => resizeObserver.observe(card.querySelector('.console-card-back')));
}

function statusValue(key) {
  return document.querySelector(`[data-console-status="${key}"]`);
}

function statusSub(key) {
  return document.querySelector(`[data-console-status-sub="${key}"]`);
}

function syncBroadcastFromDom() {
  const audioLive = el('live-onair') && !el('live-onair').hidden;
  const videoLive = el('live-video-onair') && !el('live-video-onair').hidden;
  const nowPlaying = el('dash-np')?.textContent.trim();
  const mode = el('dash-mode')?.textContent.trim();
  const value = statusValue('broadcast');
  if (!value) return;
  value.className = 'console-status-value';
  if (videoLive) {
    value.textContent = '● VIDEO LIVE';
    value.classList.add('is-live');
  } else if (audioLive) {
    value.textContent = '● LIVE HOST';
    value.classList.add('is-live');
  } else if (nowPlaying && nowPlaying !== '—' && nowPlaying !== 'Nothing playing') {
    value.textContent = 'ON AIR';
    value.classList.add('is-ok');
  } else {
    value.textContent = 'STANDBY';
  }
  statusSub('broadcast').textContent = mode || '';
}

function dollars(cents) {
  return `$${((Number(cents) || 0) / 100).toFixed(2)}`;
}

function renderUnlocks(unlocks) {
  const list = el('dash-earnings-list');
  if (!list) return;
  if (!unlocks?.length) {
    list.innerHTML = '<div class="earnings-empty">No unlock sales in this period.</div>';
    return;
  }
  list.innerHTML = unlocks.map(item => `
    <div class="earnings-row">
      <span class="earnings-title">${esc(item.title)}</span>
      <span class="earnings-kind">${esc(String(item.unlockType || '').replace('_', ' '))}</span>
      <span class="earnings-units">${item.unitsSold || 0}×</span>
      <span class="earnings-amount">${dollars(item.revenueCents)}</span>
    </div>`).join('');
}

function renderEarningsPeriod() {
  if (!earningsPayload) return;
  const totals = earningsPayload.totals || {};
  const today = earningsPeriod === 'today';
  const revenue = today ? totals.todayRevenueCents : totals.revenueCents;
  const units = today ? totals.todayUnitsSold : totals.unitsSold;
  const tipRevenue = today ? totals.todayTipRevenueCents : totals.tipRevenueCents;
  const tipCount = today ? totals.todayTipCount : totals.tipCount;
  const periodLabel = today ? 'TODAY' : 'LIFETIME';

  const totalHost = el('dash-earnings-totals');
  if (totalHost) totalHost.innerHTML = `
    <div class="stat-card"><div class="stat-val">${dollars(revenue)}</div><div class="stat-key">${periodLabel} REVENUE</div></div>
    <div class="stat-card"><div class="stat-val">${units || 0}</div><div class="stat-key">UNLOCKS</div></div>
    <div class="stat-card"><div class="stat-val">${dollars(tipRevenue)}</div><div class="stat-key">TIPS (${tipCount || 0})</div></div>
    <div class="stat-card"><div class="stat-val">${totals.activeSubscriptions || 0}</div><div class="stat-key">ACTIVE SUBS</div></div>`;
  renderUnlocks(today ? earningsPayload.todayUnlocks : earningsPayload.unlocks);

  statusValue('earnings').textContent = dollars(revenue);
  statusSub('earnings').textContent = `${tipCount || 0} tips · ${units || 0} unlocks`;
  document.querySelector('[data-console-status-cell="earnings"] .console-status-label').textContent = periodLabel;
  document.querySelectorAll('[data-console-earnings-period]').forEach(node => { node.textContent = periodLabel; });
  const button = document.querySelector('[data-console-status-cell="earnings"]');
  button?.setAttribute('aria-label', `Show ${today ? 'lifetime' : 'today'} earnings`);
}

function toggleEarningsPeriod() {
  earningsPeriod = earningsPeriod === 'today' ? 'lifetime' : 'today';
  renderEarningsPeriod();
}

export function init() {
  const content = el('dash-content');
  if (!content || content.dataset.consoleBuilt) return;
  content.dataset.consoleBuilt = '1';
  buildLayout(content);

  const observer = new MutationObserver(syncBroadcastFromDom);
  ['dash-np', 'dash-mode', 'live-onair', 'live-video-onair'].forEach(id => {
    const node = el(id);
    if (node) observer.observe(node, { attributes: true, childList: true, subtree: true });
  });
  syncBroadcastFromDom();
}

export function updateListeners(data = {}) {
  const value = statusValue('listeners');
  if (!value) return;
  value.textContent = String(data.currentListeners || 0);
  statusSub('listeners').textContent = `Peak today ${data.peakToday || 0}`;
}

export function updateQueue(queue = []) {
  const value = statusValue('queue');
  if (!value) return;
  value.textContent = `${queue.length} track${queue.length === 1 ? '' : 's'}`;
  statusSub('queue').textContent = queue[0] ? `Next: ${queue[0].title || `Track ${queue[0].id}`}` : 'Queue empty';
}

export function updateHealth({ state = 'idle', label = 'Not checked', url = '' } = {}) {
  const value = statusValue('health');
  if (!value) return;
  value.textContent = label;
  value.className = `console-status-value${state === 'ok' ? ' is-ok' : state === 'error' ? ' is-error' : ''}`;
  statusSub('health').textContent = url;
}

export function updateSchedule({ mode = 'SHUFFLE', block = null } = {}) {
  const value = statusValue('schedule');
  if (!value) return;
  const scheduled = String(mode).toUpperCase() === 'SCHEDULED';
  value.textContent = scheduled ? (block?.label || 'NO ACTIVE BLOCK') : 'SHUFFLE';
  statusSub('schedule').textContent = scheduled && block
    ? `${block.start_time || ''}–${block.end_time || ''}`
    : String(mode).toUpperCase();
}

export function updateEarnings(payload) {
  earningsPayload = payload;
  renderEarningsPeriod();
}
