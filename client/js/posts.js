/**
 * posts.js — Listener-facing creator posts (Patreon-style text updates).
 * Renders below the library drawer; visibility is enforced server-side by tier.
 */

import { el, esc } from './utils.js';
import * as api from './api.js';

export async function loadPosts() {
  const list = el('posts-list');
  if (!list) return;
  try {
    const { posts } = await api.posts.list();
    if (!posts.length) {
      list.innerHTML = '<div style="font-size:11px;color:rgba(255,255,255,.25);font-family:\'Space Mono\',monospace;padding:8px 0;">No posts yet.</div>';
      return;
    }
    list.innerHTML = posts.map(p => {
      const date = new Date(p.published_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
      const badge = p.visibility === 'supporters_only'
        ? '<span style="font-size:9px;color:#ffb347;border:1px solid rgba(255,179,71,.4);border-radius:4px;padding:1px 5px;margin-left:6px;letter-spacing:.05em;">SUPPORTERS ONLY</span>'
        : '';
      const title = p.title
        ? `<div style="font-family:'DM Serif Display',serif;font-size:15px;color:rgba(255,255,255,.85);">${esc(p.title)}${badge}</div>`
        : (badge ? `<div>${badge}</div>` : '');
      return `
        <div class="lib-row" style="display:block;padding:10px 4px;">
          ${title}
          <div style="font-family:'Space Mono',monospace;font-size:10px;color:rgba(255,255,255,.3);margin:3px 0 6px;">${esc(date)}</div>
          <div style="font-size:13px;color:rgba(255,255,255,.65);line-height:1.5;white-space:pre-wrap;">${esc(p.body)}</div>
        </div>`;
    }).join('');
  } catch {}
}
