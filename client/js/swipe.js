// Swipe-to-change-tab (STACK / PLAY / STUDIO) for touch devices.
// Reuses the existing .view-tab click handler (main.js) to actually commit a
// tab change, so this module only owns gesture detection and the live
// finger-follow drag animation.

import { el } from './utils.js';

const ORDER = ['stack', 'player', 'dashboard'];
const AXIS_LOCK_PX  = 8;   // movement before we decide horizontal vs vertical
const COMMIT_PX     = 60;  // min drag distance to commit a tab change
const COMMIT_MS     = 300; // a fast flick can commit with less distance
const COMMIT_FLICK_PX = 20;
const RESIST         = 0.3; // drag multiplier past the first/last tab

function currentIndex() {
  const card = el('player-card');
  if (card.classList.contains('stack-active')) return 0;
  if (card.classList.contains('dash-active'))  return 2;
  return 1;
}

function panels() {
  return [el('panel-stack'), el('panel-player'), el('panel-dashboard')];
}

export function initSwipeHandlers() {
  if (!document.body.classList.contains('is-touch')) return;

  const container = el('card-panels');
  let startX = 0, startY = 0, startTime = 0;
  let startIndex = 1;
  let axis = null; // 'x' | 'y' | null

  container.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) return;
    if (el('player-card').classList.contains('bio-landing')) return;
    if (e.target.closest('.dash-drag-handle')) return;

    const t = e.touches[0];
    startX = t.clientX;
    startY = t.clientY;
    startTime = Date.now();
    startIndex = currentIndex();
    axis = null;
  }, { passive: true });

  container.addEventListener('touchmove', e => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;

    if (axis === null) {
      if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return;
      axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (axis === 'x') container.classList.add('swiping');
    }
    if (axis !== 'x') return;

    e.preventDefault();

    let dragDx = dx;
    if ((startIndex === 0 && dx > 0) || (startIndex === ORDER.length - 1 && dx < 0)) {
      dragDx = dx * RESIST;
    }

    panels().forEach((panel, i) => {
      const basePct = (i - startIndex) * 100;
      panel.style.transform = `translateX(calc(${basePct}% + ${dragDx}px))`;
    });
  }, { passive: false });

  function endGesture(dx, elapsed) {
    const wasHorizontal = axis === 'x';
    axis = null;
    if (!wasHorizontal) return;

    const passedDistance = Math.abs(dx) > COMMIT_PX;
    const passedFlick    = Math.abs(dx) > COMMIT_FLICK_PX && elapsed < COMMIT_MS;
    let targetIndex = startIndex;
    if (passedDistance || passedFlick) {
      targetIndex = startIndex + (dx < 0 ? 1 : -1);
      targetIndex = Math.max(0, Math.min(ORDER.length - 1, targetIndex));
    }

    container.classList.remove('swiping');
    panels().forEach(panel => { panel.style.transform = ''; });

    if (targetIndex !== startIndex) {
      const btn = document.querySelector(`.view-tab[data-view="${ORDER[targetIndex]}"]`);
      if (btn) btn.click();
    }
  }

  container.addEventListener('touchend', e => {
    const t = e.changedTouches[0];
    endGesture(t.clientX - startX, Date.now() - startTime);
  });

  container.addEventListener('touchcancel', () => {
    endGesture(0, Infinity);
  });
}
