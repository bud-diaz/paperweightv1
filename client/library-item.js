// LibraryItemScreen — detail view and access gate for a single library item.
// Self-contained: creates its own overlay element on first use.
// No hardcoded tier bypasses — all access decisions come from the API response.

const SUBSCRIBER_TIERS = new Set(['subscriber', 'pro', 'all_access']);

let previewAudio = null;

function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function fmt(sec) {
  if (!sec) return '—';
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ── Overlay DOM ───────────────────────────────────────────────────────────────

function ensureOverlay() {
  let overlay = document.getElementById('lib-item-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'lib-item-overlay';
    overlay.className = 'lib-item-overlay';
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('role', 'dialog');
    overlay.innerHTML = `
      <div class="lib-item-panel">
        <button class="lib-item-close" id="lib-item-close" aria-label="Close">×</button>
        <div id="lib-item-body"></div>
      </div>
    `;
    document.body.appendChild(overlay);

    // Close on backdrop click
    overlay.addEventListener('click', e => {
      if (e.target === overlay) closeLibraryItem();
    });
    document.getElementById('lib-item-close').addEventListener('click', closeLibraryItem);

    // Close on Escape
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !overlay.hidden) closeLibraryItem();
    });
  }
  return overlay;
}

// ── Tier check ────────────────────────────────────────────────────────────────

async function fetchTier() {
  try {
    const res = await fetch('/api/tokens/me');
    if (!res.ok) return 'free';
    const data = await res.json();
    return data.tier || 'free';
  } catch {
    return 'free';
  }
}

// ── Checkout unlock ───────────────────────────────────────────────────────────

async function redirectToCheckout() {
  try {
    const res = await fetch('/api/payment/checkout-url');
    if (!res.ok) return null;
    const { checkoutUrl } = await res.json();
    if (checkoutUrl) window.location.href = checkoutUrl;
  } catch {
    return null;
  }
}

// ── Preview ───────────────────────────────────────────────────────────────────

function stopPreview() {
  if (previewAudio) {
    previewAudio.pause();
    previewAudio.src = '';
    previewAudio = null;
  }
}

function togglePreview(item) {
  const btn    = document.getElementById('lib-item-preview');
  const status = document.getElementById('lib-item-preview-status');

  if (previewAudio && !previewAudio.paused) {
    stopPreview();
    if (btn)    btn.textContent = '▶ Preview';
    if (status) status.textContent = '';
    return;
  }

  previewAudio = new Audio(`/api/library/${item.id}/preview`);
  previewAudio.play().catch(() => {
    if (status) status.textContent = 'Preview unavailable';
  });
  if (btn) btn.textContent = '■ Stop';

  previewAudio.addEventListener('ended', () => {
    if (btn)    btn.textContent = '▶ Preview';
    if (status) status.textContent = '';
    previewAudio = null;
  }, { once: true });
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderItem(item, tier) {
  const canAccess = item.visibility === 'public' || SUBSCRIBER_TIERS.has(tier);
  const isGated   = item.visibility === 'supporters_only' && !SUBSCRIBER_TIERS.has(tier);

  document.getElementById('lib-item-body').innerHTML = `
    <div class="lib-item-meta">
      <div class="lib-item-title">${esc(item.title)}</div>
      ${item.artist ? `<div class="lib-item-artist">${esc(item.artist)}</div>` : ''}
      <div class="lib-item-badges">
        <span class="badge">${esc(item.category)}</span>
        <span class="badge">${fmt(item.duration)}</span>
        ${item.bpm ? `<span class="badge">${item.bpm} BPM</span>` : ''}
      </div>
    </div>

    ${isGated ? `
      <div class="lib-item-gate">
        <p class="lib-item-gate-msg">This track is for supporters only.</p>
        <button class="btn btn-primary btn-sm" id="lib-item-upgrade">Unlock with Supporter Access</button>
        <div id="lib-item-upgrade-msg"></div>
      </div>
    ` : `
      <div class="lib-item-actions">
        <button class="btn btn-sm" id="lib-item-preview">▶ Preview</button>
        ${canAccess && item.downloadUrl
          ? `<button class="btn btn-sm btn-primary" id="lib-item-download">↓ Download</button>`
          : ''}
      </div>
      <div id="lib-item-preview-status"></div>
    `}
  `;

  if (isGated) {
    document.getElementById('lib-item-upgrade').addEventListener('click', async () => {
      const btn = document.getElementById('lib-item-upgrade');
      const msg = document.getElementById('lib-item-upgrade-msg');
      btn.textContent = 'Loading…';
      btn.disabled = true;
      const url = await redirectToCheckout().catch(() => null);
      if (!url) {
        if (msg) msg.textContent = 'Checkout unavailable — contact the station owner.';
        btn.textContent = 'Unlock with Supporter Access';
        btn.disabled = false;
      }
      // If url exists, redirectToCheckout already navigated away
    });
    return;
  }

  document.getElementById('lib-item-preview')?.addEventListener('click', () => togglePreview(item));

  document.getElementById('lib-item-download')?.addEventListener('click', async () => {
    const btn = document.getElementById('lib-item-download');
    btn.textContent = '…';
    btn.disabled = true;
    try {
      const res = await fetch(`/api/library/${item.id}/download`);
      if (!res.ok) throw new Error('Access denied');
      const { signedUrl } = await res.json();
      window.location.href = signedUrl;
    } catch {
      btn.textContent = '✕ Access denied';
      setTimeout(() => {
        btn.textContent = '↓ Download';
        btn.disabled = false;
      }, 2000);
    }
  });
}

function renderError(message) {
  document.getElementById('lib-item-body').innerHTML =
    `<div class="empty">${esc(message)}</div>`;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function openLibraryItem(itemId) {
  const overlay = ensureOverlay();
  stopPreview();

  overlay.hidden = false;
  document.getElementById('lib-item-body').innerHTML =
    '<div class="lib-item-loading">Loading…</div>';

  try {
    const [itemRes, tier] = await Promise.all([
      fetch(`/api/library/${itemId}`),
      fetchTier(),
    ]);

    if (itemRes.status === 403) {
      // Server already gated — render upgrade prompt directly
      document.getElementById('lib-item-body').innerHTML = `
        <div class="lib-item-gate">
          <p class="lib-item-gate-msg">Supporter access required.</p>
          <button class="btn btn-primary btn-sm" id="lib-item-upgrade">Unlock with Supporter Access</button>
          <div id="lib-item-upgrade-msg"></div>
        </div>
      `;
      document.getElementById('lib-item-upgrade').addEventListener('click', async () => {
        const btn = document.getElementById('lib-item-upgrade');
        const msg = document.getElementById('lib-item-upgrade-msg');
        btn.textContent = 'Loading…';
        btn.disabled = true;
        const url = await redirectToCheckout().catch(() => null);
        if (!url) {
          if (msg) msg.textContent = 'Checkout unavailable — contact the station owner.';
          btn.textContent = 'Unlock with Supporter Access';
          btn.disabled = false;
        }
      });
      return;
    }

    if (!itemRes.ok) {
      renderError('Item not found.');
      return;
    }

    renderItem(await itemRes.json(), tier);
  } catch {
    renderError('Failed to load item.');
  }
}

export function closeLibraryItem() {
  stopPreview();
  const overlay = document.getElementById('lib-item-overlay');
  if (overlay) overlay.hidden = true;
}
