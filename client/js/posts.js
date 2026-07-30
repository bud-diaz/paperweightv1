/**
 * posts.js — Listener-facing creator posts (Patreon-style text updates).
 * Rendered as a revolving ticker at the bottom of the PLAY card, in a full-list
 * "see more" modal, and on the creator bio landing page. Visibility is enforced
 * server-side by tier.
 */

import { el, esc } from './utils.js';
import * as api from './api.js';

function renderPost(p, rowClass) {
  const date = new Date(p.published_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const badge = p.visibility === 'supporters_only'
    ? '<span class="bio-message-badge">SUPPORTERS ONLY</span>'
    : '';
  const title = p.title
    ? `<div class="bio-message-title">${esc(p.title)}${badge}</div>`
    : (badge ? `<div>${badge}</div>` : '');
  return `
    <div class="${rowClass}" data-post-id="${p.id}">
      ${title}
      <div class="bio-message-date">${esc(date)}</div>
      <div class="bio-message-body">${esc(p.body)}</div>
    </div>`;
}

// ── Revolving ticker (2 most-recent posts) ──────────────────────────────────
function tickerItem(p) {
  const title = p.title ? esc(p.title) : 'UPDATE';
  const body = (p.body || '').replace(/\s+/g, ' ').trim();
  const snippet = body.length > 140 ? esc(body.slice(0, 140)) + '…' : esc(body);
  const badge = p.visibility === 'supporters_only'
    ? '<span class="ticker-badge">SUPPORTERS</span>'
    : '';
  return `<span class="ticker-item"><span class="ticker-title">${title}</span>${badge}<span class="ticker-body">${snippet}</span></span>`;
}

export async function loadPostsTicker() {
  const card = el('posts-ticker');
  const track = el('posts-ticker-track');
  if (!card || !track) return;
  let posts = [];
  try {
    ({ posts } = await api.posts.list(1, 2));
  } catch { posts = []; }
  if (!posts.length) {
    // Keep the card visible with a static placeholder so it always loads in.
    track.classList.add('empty');
    track.classList.remove('single');
    track.innerHTML = '<span class="ticker-empty">No posts yet — new updates appear here</span>';
    card.hidden = false;
    return;
  }
  track.classList.remove('empty');
  const sep = '<span class="ticker-sep">•</span>';
  const seq = posts.map(tickerItem).join(sep) + sep;
  // Duplicate the sequence so the -50% marquee loop is seamless.
  track.innerHTML = seq + seq;
  track.classList.toggle('single', posts.length < 2);
  card.hidden = false;
}

// ── Full-list "see more" modal ──────────────────────────────────────────────
// Mirrors library-modal.js's convention (open/close via .open class on the
// *-backdrop element, click-outside-to-close).
export async function loadPostsModal() {
  const list = el('posts-modal-list');
  if (!list) return;
  try {
    const { posts } = await api.posts.list();
    list.innerHTML = posts.length
      ? posts.map(p => renderPost(p, 'bio-message-row')).join('')
      : '<div class="posts-modal-empty">No posts yet.</div>';
    posts.forEach(p => api.events.record('post_viewed', { postId:p.id, source:'post', dedupeKey:`post:${p.id}:modal:${new Date().toISOString().slice(0,10)}` }));
  } catch {
    list.innerHTML = '<div class="posts-modal-empty">Could not load posts.</div>';
  }
}

export function openPostsModal() {
  loadPostsModal();
  el('posts-modal-backdrop').classList.add('open');
}

export function closePostsModal() {
  el('posts-modal-backdrop').classList.remove('open');
}

export function initPostsModalHandlers() {
  const more = el('posts-ticker-more');
  if (more) more.addEventListener('click', openPostsModal);
  const close = el('posts-modal-close');
  if (close) close.addEventListener('click', closePostsModal);
  const backdrop = el('posts-modal-backdrop');
  if (backdrop) backdrop.addEventListener('click', e => {
    if (e.target === e.currentTarget) closePostsModal();
  });
}

// ── Bio landing page messages section ───────────────────────────────────────
export async function loadBioMessages() {
  const section = el('bio-messages-section');
  const list = el('bio-messages-list');
  if (!section || !list) return;
  try {
    const { posts } = await api.posts.list(1, 5);
    if (!posts.length) {
      section.hidden = true;
      return;
    }
    list.innerHTML = posts.map(p => renderPost(p, 'bio-message-row')).join('');
    section.hidden = false;
  } catch {
    section.hidden = true;
  }
}
