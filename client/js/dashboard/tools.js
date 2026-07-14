/**
 * dashboard/tools.js — Station settings (notify webhook, RSS feed), listener
 * account recovery links, and the embed/feed copy buttons.
 */

import * as api from '../api.js';
import { el } from '../utils.js';

export function init() {}

export async function loadDashSettings() {
  try {
    const s = await api.dashboard.settings.get();
    el('set-webhook-url').value = s.notifyWebhookUrl || '';
    el('set-notify-live').checked = !!s.notifyLiveEnabled;
    el('set-feed-enabled').checked = !!s.feedEnabled;
    el('set-feed-scope').value = s.feedScope || 'podcasts';
    el('set-track-glow-color').value = s.trackGlowColor || '#39ff14';
    el('set-email-status').textContent = s.emailConfigured
      ? 'SMTP is configured — password reset emails and supporter post emails are available.'
      : 'SMTP not configured — add SMTP_HOST / SMTP_FROM (and SMTP_USER / SMTP_PASS) to .env to enable reset and post emails.';
    const notifyRow = el('post-new-notify-row');
    if (notifyRow) notifyRow.hidden = !s.emailConfigured;
  } catch {}
}

function flashCopied(btn, original) {
  btn.textContent = 'COPIED ✓';
  setTimeout(() => { btn.textContent = original; }, 1800);
}

export function initToolsHandlers() {
  const saveBtn = el('set-save-btn');
  if (!saveBtn) return;

  saveBtn.addEventListener('click', async () => {
    const msg = el('set-msg');
    saveBtn.disabled = true;
    saveBtn.textContent = '…';
    try {
      const { res, data } = await api.dashboard.settings.update({
        notifyWebhookUrl: el('set-webhook-url').value.trim(),
        notifyLiveEnabled: el('set-notify-live').checked,
        feedEnabled: el('set-feed-enabled').checked,
        feedScope: el('set-feed-scope').value,
        trackGlowColor: el('set-track-glow-color').value,
      });
      if (res.ok) {
        msg.textContent = 'Saved ✓';
        msg.style.color = '#39ff14';
      } else {
        msg.textContent = data.error || 'Save failed';
        msg.style.color = '#ff6b6b';
      }
    } catch {
      el('set-msg').textContent = 'Network error';
      el('set-msg').style.color = '#ff6b6b';
    }
    saveBtn.disabled = false;
    saveBtn.textContent = 'SAVE SETTINGS';
    setTimeout(() => { el('set-msg').textContent = ''; }, 2500);
  });

  el('btn-copy-embed').addEventListener('click', () => {
    const code = `<iframe src="${window.location.origin}/embed" width="420" height="96" style="border:0;" title="Radio player" allow="autoplay"></iframe>`;
    navigator.clipboard?.writeText(code).catch(() => {});
    flashCopied(el('btn-copy-embed'), 'COPY EMBED CODE');
  });

  el('btn-copy-rss').addEventListener('click', () => {
    navigator.clipboard?.writeText(`${window.location.origin}/feed.xml`).catch(() => {});
    flashCopied(el('btn-copy-rss'), 'COPY FEED URL');
  });

  el('btn-reset-link').addEventListener('click', async () => {
    const out = el('reset-link-output');
    const email = el('reset-link-email').value.trim().toLowerCase();
    if (!email) {
      out.textContent = 'Enter the listener’s email first.';
      return;
    }
    out.textContent = '…';
    try {
      const accounts = await api.dashboard.accounts();
      const account = accounts.find(a => a.email.toLowerCase() === email);
      if (!account) {
        out.textContent = 'No active listener account with that email.';
        return;
      }
      const { res, data } = await api.dashboard.resetLink(account.id);
      if (!res.ok) {
        out.textContent = data.error || 'Could not generate a reset link.';
        return;
      }
      navigator.clipboard?.writeText(data.url).catch(() => {});
      out.textContent = `Copied to clipboard (valid 60 min): ${data.url}`;
    } catch {
      out.textContent = 'Network error.';
    }
  });
}
