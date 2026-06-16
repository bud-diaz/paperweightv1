/**
 * dashboard/bio.js — Creator bio landing panel and dashboard bio editor.
 */

import * as api from '../api.js';
import { el, esc } from '../utils.js';

// ── Social icons ───────────────────────────────────────────────────────────────
const SOCIAL_ICONS = {
  instagram:  `<svg viewBox="0 0 24 24"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z"/></svg>`,
  twitter:    `<svg viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>`,
  youtube:    `<svg viewBox="0 0 24 24"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>`,
  soundcloud: `<svg viewBox="0 0 24 24"><path d="M1.175 12.225C.528 12.225 0 12.772 0 13.432v.215C0 14.308.528 14.84 1.175 14.84h.058l.002-.014.026-.229c.037-.328.037-.64 0-.97l-.026-.23-.002-.014-.058-.002zm.625-2.124c-.11 0-.213.014-.31.04a6.74 6.74 0 0 0-.05.906c0 .305.017.608.05.906.097.025.2.04.31.04.583 0 1.055-.472 1.055-1.055 0-.582-.472-1.054-1.055-1.054zm1.48-1.148a7.27 7.27 0 0 0-.067 1.006c0 .338.025.67.067 1.003.04.05.09.09.14.126v-2.265a.95.95 0 0 0-.14.13zm1.14-.667c-.168 0-.33.023-.485.062a8.014 8.014 0 0 0-.114 1.374c0 .484.04.956.114 1.411.155.04.317.063.485.063.803 0 1.455-.65 1.455-1.455 0-.803-.652-1.455-1.455-1.455zm8.525-4.7C11.86 2.127 10.306 1.5 8.624 1.5c-2.61 0-4.844 1.667-5.62 4.02a3.625 3.625 0 0 0-.524-.038C1.12 5.482 0 6.603 0 7.965c0 .07.003.14.01.21C.003 8.34 0 8.508 0 8.68v.007c0 .034.001.069.002.103.037 1.54 1.302 2.775 2.854 2.775h.001V9.327c0-.803.65-1.455 1.455-1.455.215 0 .418.05.601.136.166-.85.51-1.636 1.004-2.317-.148-.193-.23-.43-.23-.687 0-.643.52-1.163 1.163-1.163.285 0 .547.103.748.27C8.3 3.8 9.152 3.5 10.07 3.5c2.396 0 4.347 1.862 4.466 4.226a.825.825 0 0 1 .29-.052c.456 0 .826.37.826.826 0 .437-.34.794-.77.822-.007.06-.01.122-.01.184 0 1.327 1.076 2.404 2.404 2.404h.002v-1.66c0-.85-.69-1.54-1.54-1.54-.042 0-.084.002-.125.005a5.47 5.47 0 0 0-.37-1.44 3.01 3.01 0 0 0 .035-.47c0-1.663-1.35-3.012-3.013-3.012-.49 0-.955.117-1.367.326z"/></svg>`,
  spotify:    `<svg viewBox="0 0 24 24"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>`,
  bandcamp:   `<svg viewBox="0 0 24 24"><path d="M0 18.75l7.437-13.5H24l-7.438 13.5z"/></svg>`,
};

export function init() {}

// ── Public bio landing panel ───────────────────────────────────────────────────
export async function loadBioPanel() {
  try {
    const d = await api.library.creatorProfile();
    if (!d.enabled) return;

    el('player-card').classList.add('bio-landing');

    if (d.profilePicUrl) {
      const img = el('bio-pic-img');
      img.src = '/api/creator/pic?' + Date.now();
      img.hidden = false;
      el('bio-pic-ph').hidden = true;
    }
    el('bio-creator-name').textContent = d.creatorName || d.stationName || 'Creator';
    el('bio-station-name').textContent = d.stationName || '';

    if (d.bio) {
      el('bio-text').textContent = d.bio;
      el('bio-text').hidden = false;
    }

    // Social buttons
    const socialRow = el('bio-social-row');
    const socialMap = { instagram: 'Instagram', twitter: 'Twitter / X', youtube: 'YouTube', soundcloud: 'SoundCloud', spotify: 'Spotify', bandcamp: 'Bandcamp' };
    for (const [key, label] of Object.entries(socialMap)) {
      const rawUrl = d.social && d.social[key];
      if (!rawUrl) continue;
      const safeUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : null;
      if (!safeUrl) continue;
      const a = document.createElement('a');
      a.className = 'bio-social-btn';
      a.href = safeUrl;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.title = label;
      a.innerHTML = SOCIAL_ICONS[key] || '';
      socialRow.appendChild(a);
    }

    // Latest track card
    if (d.latestTrack) {
      el('bio-latest-title').textContent = d.latestTrack.title || '—';
      const sub = [d.latestTrack.artist, d.latestTrack.category].filter(Boolean).join(' · ');
      el('bio-latest-sub').textContent = sub;
      el('bio-latest-card').hidden = false;
    }

    // Creator since card
    if (d.creatorSince) {
      const yr = new Date(d.creatorSince).getFullYear();
      el('bio-since-val').textContent = isNaN(yr) ? d.creatorSince.slice(0, 10) : String(yr);
      el('bio-since-card').hidden = false;
    }
  } catch {}
}

// ── Dashboard bio editor ───────────────────────────────────────────────────────
export async function loadDashBio() {
  try {
    const d = await api.creator.profile();
    el('bio-toggle').checked = !!d.bio_enabled;
    updateBioSectionState();
    if (d.bio)             el('bio-bio-input').value   = d.bio;
    if (d.social_instagram) el('bio-instagram').value  = d.social_instagram;
    if (d.social_twitter)   el('bio-twitter').value    = d.social_twitter;
    if (d.social_youtube)   el('bio-youtube').value    = d.social_youtube;
    if (d.social_soundcloud)el('bio-soundcloud').value = d.social_soundcloud;
    if (d.social_spotify)   el('bio-spotify').value    = d.social_spotify;
    if (d.social_bandcamp)  el('bio-bandcamp').value   = d.social_bandcamp;
    if (d.profile_pic_url) {
      const prev = el('dash-bio-pic-preview');
      prev.src = '/api/creator/pic?' + Date.now();
      prev.style.display = 'block';
    }
  } catch {}
}

export function updateBioSectionState() {
  const on = el('bio-toggle').checked;
  el('bio-details').style.pointerEvents = on ? '' : 'none';
  el('bio-edit-body').classList.toggle('bio-dash-blocked', !on);
}

// ── Bio event handlers ─────────────────────────────────────────────────────────
export function initBioHandlers() {
  el('bio-enter-btn').addEventListener('click', () => {
    window._bioSessionPassed = true;
    el('player-card').classList.remove('bio-landing');
  });

  el('bio-toggle').addEventListener('change', async () => {
    updateBioSectionState();
    const on = el('bio-toggle').checked;
    if (on) el('bio-details').open = true;
    try {
      await api.creator.updateProfile({ bio_enabled: on ? 1 : 0 });
    } catch {}
  });

  el('bio-save-btn').addEventListener('click', async () => {
    const msg = el('bio-save-msg');
    try {
      const body = {
        bio_enabled:       el('bio-toggle').checked ? 1 : 0,
        bio:               el('bio-bio-input').value.trim()   || null,
        social_instagram:  el('bio-instagram').value.trim()   || null,
        social_twitter:    el('bio-twitter').value.trim()     || null,
        social_youtube:    el('bio-youtube').value.trim()     || null,
        social_soundcloud: el('bio-soundcloud').value.trim()  || null,
        social_spotify:    el('bio-spotify').value.trim()     || null,
        social_bandcamp:   el('bio-bandcamp').value.trim()    || null,
      };
      await api.creator.updateProfile(body);
      msg.textContent = 'SAVED'; msg.style.color = '#39ff14';
      setTimeout(() => { msg.textContent = ''; }, 2000);
    } catch {
      msg.textContent = 'FAILED'; msg.style.color = '#ff6b6b';
    }
  });

  el('bio-pic-file').addEventListener('change', () => {
    const f = el('bio-pic-file').files[0];
    if (!f) return;
    el('bio-pic-filename').textContent = f.name;
    el('bio-pic-upload-btn').style.display = '';
  });

  el('bio-pic-upload-btn').addEventListener('click', async () => {
    const f = el('bio-pic-file').files[0];
    if (!f) return;
    const msg = el('bio-pic-msg');
    const btn = el('bio-pic-upload-btn');
    btn.disabled = true; btn.textContent = '…';
    try {
      const fd = new FormData();
      fd.append('pic', f);
      const res = await api.creator.uploadPic(fd);
      if (res.ok) {
        msg.textContent = 'UPLOADED'; msg.style.color = '#39ff14';
        const prev = el('dash-bio-pic-preview');
        prev.src = '/api/creator/pic?' + Date.now();
        prev.style.display = 'block';
        btn.textContent = 'UPLOAD'; btn.disabled = false;
        setTimeout(() => { msg.textContent = ''; }, 2000);
      } else throw new Error();
    } catch {
      msg.textContent = 'FAILED'; msg.style.color = '#ff6b6b';
      btn.textContent = 'UPLOAD'; btn.disabled = false;
    }
  });
}
