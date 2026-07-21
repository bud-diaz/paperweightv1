// Confirmation step for the mobile Studio device-pairing flow. Deliberately
// requires a tap (not just loading this page) so a chat-app link-preview
// crawler prefetching the QR/link URL can't silently burn the one-time
// pairing token — see src/auth/device-pairing.js.

const btn = document.getElementById('pair-confirm-btn');
const msg = document.getElementById('pair-msg');

const pairToken = new URLSearchParams(location.search).get('pt');

if (!pairToken) {
  btn.disabled = true;
  msg.textContent = 'Missing pairing code — scan the QR code again from Studio.';
  msg.classList.add('error');
} else {
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    msg.textContent = '';
    msg.classList.remove('error', 'ok');
    try {
      const res = await fetch('/api/auth/dashboard/device/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pairToken }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        msg.textContent = data.error || 'This pairing code has expired or was already used. Generate a new one from Studio.';
        msg.classList.add('error');
        btn.disabled = false;
        return;
      }
      msg.textContent = 'Signed in — redirecting…';
      msg.classList.add('ok');
      setTimeout(() => { location.href = '/'; }, 800);
    } catch {
      msg.textContent = 'Could not reach the server. Check your connection and try again.';
      msg.classList.add('error');
      btn.disabled = false;
    }
  });
}
