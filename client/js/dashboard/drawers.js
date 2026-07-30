/**
 * dashboard/drawers.js — Studio dashboard status strip + 6-drawer, single-open
 * accordion (replaces the old per-section drag-reorder cards and the
 * mission-control flip-card grid). Existing dashboard sections and their IDs
 * are moved into drawers, never cloned, so every dashboard/*.js module's
 * el(...) lookups keep working unchanged.
 */

import { el, esc } from '../utils.js';
import { openGoLiveModal } from './golive.js';

const OPEN_STORAGE = 'pw_dash_section_open';
const DEFAULT_OPEN = 'today';

const DRAWER_DEFS = [
  { key: 'today',        title: 'TODAY' },
  { key: 'audience',     title: 'AUDIENCE MEMORY' },
  { key: 'releases',     title: 'RELEASE AUTOPILOT' },
  { key: 'automations',  title: 'AUTOMATIONS' },
  { key: 'station',      title: 'STATION & BROADCAST' },
  { key: 'community',    title: 'COMMUNITY' },
  { key: 'library',      title: 'LIBRARY' },
  { key: 'monetization', title: 'MONETIZATION' },
  { key: 'analytics',    title: 'ANALYTICS' },
  { key: 'ops',          title: 'STATION OPS' },
  { key: 'security',     title: 'SECURITY & DEVICES' },
];

let drawerList = null;
let openKey = DEFAULT_OPEN;
let earningsPayload = null;
let earningsPeriod = 'today';

// ---------- status strip ----------

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

// ---------- drawer accordion ----------

function readOpenKey() {
  const raw = localStorage.getItem(OPEN_STORAGE);
  return DRAWER_DEFS.some(d => d.key === raw) ? raw : DEFAULT_OPEN;
}

// Drives the open/close height animation. Bodies default to `height: 0` in
// CSS; opening measures the natural content height and animates to it, then
// releases to `height: auto` once settled so nested content (e.g. the
// schedule/analytics sub-accordions) can keep growing without being clipped.
function setDrawerOpen(drawer, isOpen, { animate = true } = {}) {
  const body = drawer.querySelector('.studio-drawer-body');
  const head = drawer.querySelector('.studio-drawer-head');
  const title = drawer.querySelector('.studio-drawer-title').textContent;
  drawer.classList.toggle('open', isOpen);
  head.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  head.setAttribute('aria-label', `${isOpen ? 'Collapse' : 'Expand'} ${title} section`);

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
      if (drawer.classList.contains('open')) body.style.height = 'auto';
    });
  } else {
    body.style.height = `${body.scrollHeight}px`;
    requestAnimationFrame(() => { body.style.height = '0px'; });
  }
}

function applyAccordion({ animate = false } = {}) {
  if (!drawerList) return;
  drawerList.querySelectorAll(':scope > .studio-drawer').forEach(drawer => {
    setDrawerOpen(drawer, drawer.dataset.drawerKey === openKey, { animate });
  });
}

export function openSection(key, { animate = false } = {}) {
  if (!drawerList) return false;
  const drawer = drawerList.querySelector(`:scope > .studio-drawer[data-drawer-key="${key}"]`);
  if (!drawer) return false;

  if (openKey === key) {
    if (!animate) setDrawerOpen(drawer, true, { animate: false });
    return true;
  }

  const oldKey = openKey;
  openKey = key;
  localStorage.setItem(OPEN_STORAGE, openKey);
  const oldDrawer = drawerList.querySelector(`:scope > .studio-drawer[data-drawer-key="${oldKey}"]`);
  if (oldDrawer) setDrawerOpen(oldDrawer, false, { animate });
  setDrawerOpen(drawer, true, { animate });
  return true;
}

function makeDrawer(key, title, sections) {
  const drawer = document.createElement('section');
  drawer.className = 'studio-drawer';
  drawer.id = `studio-drawer-${key}`;
  drawer.dataset.drawerKey = key;

  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'studio-drawer-head';
  head.setAttribute('aria-expanded', 'false');
  head.setAttribute('aria-label', `Expand ${title} section`);
  head.addEventListener('click', () => openSection(key, { animate: true }));

  const titleEl = document.createElement('span');
  titleEl.className = 'studio-drawer-title';
  titleEl.textContent = title;

  const chevron = document.createElement('span');
  chevron.className = 'studio-drawer-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.textContent = '▾';

  head.appendChild(titleEl);
  head.appendChild(chevron);

  const body = document.createElement('div');
  body.className = 'studio-drawer-body';
  const content = document.createElement('div');
  content.className = 'studio-drawer-content';
  sections.forEach(section => content.appendChild(section));
  body.appendChild(content);

  drawer.appendChild(head);
  drawer.appendChild(body);
  return drawer;
}

function buildLayout(content) {
  const sections = [...content.querySelectorAll(':scope > .dash-section')];
  if (!sections.length) return;

  const groups = new Map();
  sections.forEach(section => {
    const key = section.dataset.drawer;
    if (!key) return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(section);
  });

  content.querySelectorAll(':scope > .dash-divider').forEach(node => node.remove());

  // Analytics is a lone-member drawer whose head already reads "ANALYTICS";
  // force its inner <details> open and let CSS hide the now-redundant
  // <summary> label so there's no double disclosure triangle.
  el('analytics-details')?.setAttribute('open', '');

  const root = document.createElement('div');
  root.className = 'studio-drawers';

  const list = document.createElement('div');
  list.className = 'studio-drawer-list';
  DRAWER_DEFS.forEach(({ key, title }) => {
    const groupSections = groups.get(key);
    if (!groupSections || !groupSections.length) return;
    list.appendChild(makeDrawer(key, title, groupSections));
  });

  root.appendChild(createStatusStrip());
  root.appendChild(list);
  content.appendChild(root);

  drawerList = list;
  openKey = readOpenKey();
  applyAccordion({ animate: false });
}

export function init() {
  const content = el('dash-content');
  if (!content || content.dataset.drawersBuilt) return;
  content.dataset.drawersBuilt = '1';
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
