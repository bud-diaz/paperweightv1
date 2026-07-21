/**
 * dashboard/golive.js — Go Live modal shell: open/close and the AUDIO/VIDEO
 * mode-tab switch. The audio/video panes themselves stay owned by
 * dashboard/live.js, dashboard/live-external.js, and dashboard/liveVideo.js
 * (this module only toggles which pane is visible); closing the modal never
 * stops a broadcast, it just hides the overlay.
 */

import { el } from '../utils.js';

let lastTab = 'audio';

function isOnAir(id) {
  const node = el(id);
  return !!node && !node.hidden;
}

export function setGoLiveTab(mode) {
  lastTab = mode;
  const modal = el('golive-modal');
  if (!modal) return;
  modal.querySelectorAll('.golive-tab').forEach(tab =>
    tab.classList.toggle('active', tab.dataset.goliveTab === mode));
  modal.querySelectorAll('.golive-pane').forEach(pane =>
    pane.classList.toggle('active', pane.dataset.golivePane === mode));
}

export function openGoLiveModal(mode) {
  const tab = mode || (isOnAir('live-video-onair') ? 'video' : isOnAir('live-onair') ? 'audio' : lastTab);
  setGoLiveTab(tab);
  el('golive-modal-backdrop').classList.add('open');
}

export function closeGoLiveModal() {
  el('golive-modal-backdrop').classList.remove('open');
}

export function initGoLiveModalHandlers() {
  el('golive-modal-close').addEventListener('click', closeGoLiveModal);
  el('golive-modal-backdrop').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeGoLiveModal();
  });
  el('golive-modal').querySelectorAll('.golive-tab').forEach(btn => {
    btn.addEventListener('click', () => setGoLiveTab(btn.dataset.goliveTab));
  });
}
