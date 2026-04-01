import { openLibraryItem } from './library-item.js';

const CATEGORIES = ['music', 'beats', 'podcasts', 'videos', 'drafts', 'live_sessions'];
let state = { page: 1, category: '', search: '', total: 0, debounceTimer: null };
let activePreview = null;

function el(id) { return document.getElementById(id); }
function fmt(sec) {
  if (!sec) return '—';
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ── Category pills ────────────────────────────────────────────────────────────

function renderPills() {
  const container = el('category-pills');
  const all = [{ label: 'All', value: '' }, ...CATEGORIES.map(c => ({ label: cap(c), value: c }))];
  container.innerHTML = all.map(c => `
    <button class="pill ${state.category === c.value ? 'active' : ''}" data-cat="${c.value}">
      ${c.label}
    </button>
  `).join('');
  container.querySelectorAll('.pill').forEach(btn => {
    btn.addEventListener('click', () => {
      state.category = btn.dataset.cat;
      state.page = 1;
      loadLibrary();
    });
  });
}

function cap(s) { return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()); }

// ── Media cards ───────────────────────────────────────────────────────────────

function renderCards(items, tier) {
  const grid = el('media-grid');
  if (!items.length) {
    grid.innerHTML = '<div class="empty">No tracks found.</div>';
    return;
  }
  grid.innerHTML = items.map(item => `
    <div class="media-card">
      <div class="card-top">
        <div class="card-info">
          <div class="card-title card-title-link" title="${esc(item.title)}" data-open="${item.id}">${esc(item.title)}</div>
          <div class="card-artist">${esc(item.artist || '—')}</div>
        </div>
      </div>
      <div class="card-meta">
        <span class="badge">${cap(item.category)}</span>
        <span class="badge">${fmt(item.duration)}</span>
        ${item.bpm ? `<span class="badge">${item.bpm} BPM</span>` : ''}
        ${item.visibility === 'supporters_only' ? '<span class="badge badge-locked">Supporters</span>' : ''}
      </div>
      <div class="card-actions">
        <button class="btn btn-sm" data-preview="${item.id}">▶ Preview</button>
        <button class="btn btn-sm" data-open="${item.id}">Details</button>
      </div>
      <audio id="preview-${item.id}" hidden></audio>
    </div>
  `).join('');

  // Preview buttons
  grid.querySelectorAll('[data-preview]').forEach(btn => {
    btn.addEventListener('click', () => togglePreview(btn.dataset.preview, btn));
  });

  // Open LibraryItemScreen on title click or Details button
  grid.querySelectorAll('[data-open]').forEach(el => {
    el.addEventListener('click', () => openLibraryItem(el.dataset.open));
  });
}

function togglePreview(id, btn) {
  const audio = document.getElementById(`preview-${id}`);
  if (!audio) return;

  // Stop any other preview
  if (activePreview && activePreview !== audio) {
    activePreview.pause();
    activePreview.src = '';
    const prevBtn = document.querySelector(`[data-preview="${activePreview.id.replace('preview-', '')}"]`);
    if (prevBtn) prevBtn.textContent = '▶ Preview';
  }

  if (audio.paused) {
    audio.src = `/api/library/${id}/preview`;
    audio.play().catch(() => {});
    btn.textContent = '■ Stop';
    activePreview = audio;
    audio.addEventListener('ended', () => { btn.textContent = '▶ Preview'; activePreview = null; }, { once: true });
  } else {
    audio.pause();
    audio.src = '';
    btn.textContent = '▶ Preview';
    activePreview = null;
  }
}

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Pagination ────────────────────────────────────────────────────────────────

function renderPagination(total, limit) {
  const pages = Math.ceil(total / limit);
  const container = el('pagination');
  if (pages <= 1) { container.hidden = true; return; }
  container.hidden = false;
  container.innerHTML = `
    <button class="btn btn-sm" id="pg-prev" ${state.page <= 1 ? 'disabled' : ''}>← Prev</button>
    <span class="page-info">Page ${state.page} of ${pages}</span>
    <button class="btn btn-sm" id="pg-next" ${state.page >= pages ? 'disabled' : ''}>Next →</button>
  `;
  document.getElementById('pg-prev')?.addEventListener('click', () => { state.page--; loadLibrary(); });
  document.getElementById('pg-next')?.addEventListener('click', () => { state.page++; loadLibrary(); });
}

// ── Token redeem ──────────────────────────────────────────────────────────────

function setupRedeemForm() {
  el('token-redeem-btn').addEventListener('click', async () => {
    const token = el('token-input').value.trim();
    if (!token) return;
    const msg = el('token-msg');
    try {
      const res = await fetch('/api/tokens/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (res.ok) {
        msg.className = 'success-msg';
        msg.textContent = 'Access granted! Reloading…';
        setTimeout(() => loadLibrary(), 1200);
      } else {
        msg.className = 'error-msg';
        msg.textContent = data.error || 'Invalid token';
      }
    } catch {
      msg.className = 'error-msg';
      msg.textContent = 'Network error';
    }
  });
}

// ── Main load ─────────────────────────────────────────────────────────────────

async function loadLibrary() {
  const params = new URLSearchParams({ page: state.page, limit: 20 });
  if (state.category) params.set('category', state.category);
  if (state.search)   params.set('search',   state.search);

  try {
    const [libRes, meRes] = await Promise.all([
      fetch(`/api/library?${params}`),
      fetch('/api/tokens/me'),
    ]);
    const { items, total, limit } = await libRes.json();
    const { tier } = await meRes.json();

    renderPills();
    renderCards(items, tier);
    renderPagination(total, limit);

    // Show subscriber gate only for free-tier visitors
    el('subscriber-gate').hidden = (tier === 'subscriber');
  } catch {
    el('media-grid').innerHTML = '<div class="empty">Failed to load library.</div>';
  }
}

export function initLibrary() {
  setupRedeemForm();

  el('lib-search').addEventListener('input', e => {
    clearTimeout(state.debounceTimer);
    state.debounceTimer = setTimeout(() => {
      state.search = e.target.value.trim();
      state.page = 1;
      loadLibrary();
    }, 300);
  });

  // After returning from Stripe checkout, show a brief success notice and reload
  // the library so the updated tier is reflected. The ?subscribed=1 param is set
  // by /api/payment/web-success before redirecting back here.
  if (new URLSearchParams(window.location.search).get('subscribed') === '1') {
    const msg = document.createElement('div');
    msg.className = 'success-msg';
    msg.style.cssText = 'margin-bottom:16px;padding:12px;border-radius:6px';
    msg.textContent = 'Welcome. You now have full supporter access.';
    el('media-grid').before(msg);
    setTimeout(() => msg.remove(), 5000);

    // Strip the query param from the URL without a page reload
    history.replaceState(null, '', window.location.pathname + window.location.hash);
  }

  loadLibrary();
}
