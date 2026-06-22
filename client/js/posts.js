/**
 * posts.js — Listener-facing creator posts (Patreon-style text updates).
 * Rendered both below the library drawer and on the creator bio landing page;
 * visibility is enforced server-side by tier.
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
    <div class="${rowClass}">
      ${title}
      <div class="bio-message-date">${esc(date)}</div>
      <div class="bio-message-body">${esc(p.body)}</div>
    </div>`;
}

export async function loadPosts() {
  const list = el('posts-list');
  if (!list) return;
  try {
    const { posts } = await api.posts.list();
    if (!posts.length) {
      list.innerHTML = '<div style="font-size:11px;color:rgba(255,255,255,.25);font-family:\'Space Mono\',monospace;padding:8px 0;">No posts yet.</div>';
      return;
    }
    list.innerHTML = posts.map(p => renderPost(p, 'bio-message-row')).join('');
  } catch {}
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
