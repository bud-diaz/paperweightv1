/**
 * library-modal.js — Full library browser modal, opened from the curated
 * 3-row listener drawer (library.js buildLibrary()).
 *
 * Mirrors payment.js's modal convention (open/close via .open class on a
 * *-backdrop element, click-outside-to-close).
 */

import { el } from './utils.js';
import { buildFullLibraryList } from './library.js';

export function openLibraryModal() {
  buildFullLibraryList('library-modal-list');
  el('library-modal-backdrop').classList.add('open');
}

export function closeLibraryModal() {
  el('library-modal-backdrop').classList.remove('open');
}

export function initLibraryModalHandlers() {
  el('library-modal-close').addEventListener('click', closeLibraryModal);
  el('library-modal-backdrop').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeLibraryModal();
  });
}
