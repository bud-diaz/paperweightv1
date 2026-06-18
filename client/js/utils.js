// Pure helper utilities — stateless, no imports, no side effects on import.
// Functions that touch the DOM do so only when called, never at module load time.

// PALETTE duplicated here (also in state.js) to keep utils.js dependency-free.
const PALETTE = ['#F9C74F','#FF3CAC','#00F5D4','#4CC9F0','#A78BFA'];

export function el(id) {
  return document.getElementById(id);
}

export function fmt(s) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function showToast(msg, ms = 2200) {
  let t = document.getElementById('pw-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'pw-toast';
    t.style.cssText = 'position:fixed;bottom:90px;left:50%;transform:translateX(-50%);background:rgba(10,10,10,.92);border:1px solid rgba(255,255,255,.12);color:rgba(255,255,255,.85);font-family:"Space Mono",monospace;font-size:11px;letter-spacing:.06em;padding:7px 16px;border-radius:6px;z-index:9999;pointer-events:none;transition:opacity .25s;';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = '1';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.style.opacity = '0'; }, ms);
}

export function setDrawer(id, open) {
  document.getElementById(id).style.maxHeight = open ? '300px' : '0';
}

export function trackColor(id) {
  return PALETTE[Math.abs(id || 0) % PALETTE.length];
}

export function generateWaveform(id) {
  const n = id || 0;
  return Array.from({ length: 80 }, (_, i) => 0.15 + Math.abs(Math.sin(i * (0.3 + n * 0.07) + n)) * 0.82);
}

export function ellipsisText(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  while (text.length > 1 && ctx.measureText(text + '…').width > maxW) text = text.slice(0, -1);
  return text + '…';
}
