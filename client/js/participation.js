/** Listener-facing polls, premiere reminders, and track requests. */
import * as api from './api.js';
import { el, esc, showToast } from './utils.js';

let loaded = false;

function when(value) {
  const date = new Date(String(value || '').replace(' ', 'T') + (String(value || '').includes('Z') ? '' : 'Z'));
  return Number.isNaN(date.getTime()) ? String(value || '') : date.toLocaleString([], { dateStyle:'medium', timeStyle:'short' });
}
async function loadContent() {
  try {
    const [participation, upcoming, library] = await Promise.all([
      api.participation.active(), api.participation.upcoming(), api.library.list({ limit:100 }),
    ]);
    const polls = participation.polls || [];
    const releases = upcoming.releases || [];
    const tracks = (library.items || []).filter(item => item.visibility === 'public');
    if (!polls.length && !releases.length && !tracks.length) return;
    el('fan-signal-btn').hidden = false;
    el('fan-signal-content').innerHTML = [
      ...polls.map(poll => `<section class="fan-block"><div class="necessity-kicker">LIVE POLL</div><h3>${esc(poll.question)}</h3>${poll.options.map(option => `<div class="fan-option"><button class="mgmt-btn" data-fan-vote="${option.id}" data-fan-poll="${poll.id}">${esc(option.label)}</button><span class="necessity-status">${Number(option.votes) || 0}</span></div>`).join('')}</section>`),
      ...releases.map(release => `<section class="fan-block"><div class="necessity-kicker">UPCOMING RELEASE</div><h3>${esc(release.title)}</h3><p>${esc(release.description || `${release.itemCount} track${release.itemCount === 1 ? '' : 's'}`)} · ${esc(when(release.releaseAt))}</p><button class="mgmt-btn active" data-fan-remind="${release.id}">REMIND ME</button></section>`),
      tracks.length ? `<section class="fan-block"><div class="necessity-kicker">REQUEST LINE</div><h3>Put a track in the creator’s hands</h3><p>The creator decides what enters the station queue.</p><select class="dash-input" id="fan-request-track"><option value="">CHOOSE A TRACK</option>${tracks.map(track => `<option value="${track.id}">${esc(track.title || track.filename)}</option>`).join('')}</select><input class="dash-input" id="fan-request-dedication" maxlength="240" placeholder="Optional dedication" style="margin-top:6px"/><button class="mgmt-btn active" id="fan-request-send" style="margin-top:7px">SEND REQUEST</button></section>` : '',
    ].join('');
  } catch {}
}

export function init() {
  if (loaded) return;
  loaded = true;
  loadContent();
  el('fan-signal-btn')?.addEventListener('click', () => { el('fan-signal-panel').hidden = !el('fan-signal-panel').hidden; if (!el('fan-signal-panel').hidden) loadContent(); });
  el('fan-signal-close')?.addEventListener('click', () => { el('fan-signal-panel').hidden = true; });
  el('fan-signal-content')?.addEventListener('click', async event => {
    const vote = event.target.closest('[data-fan-vote]');
    const remind = event.target.closest('[data-fan-remind]');
    if (vote) {
      const { res, data } = await api.participation.vote(vote.dataset.fanPoll, vote.dataset.fanVote);
      showToast(res.ok ? 'Vote recorded' : (data.error || 'Could not vote'));
      if (res.ok) loadContent();
    }
    if (remind) {
      const { res, data } = await api.participation.remind(remind.dataset.fanRemind);
      showToast(res.ok ? (data.created ? 'Reminder set' : 'Reminder already set') : (data.error || 'Could not set reminder'));
    }
    if (event.target.closest('#fan-request-send')) {
      const mediaId = Number(el('fan-request-track').value);
      if (!mediaId) return showToast('Choose a track first');
      const { res, data } = await api.participation.request(mediaId, el('fan-request-dedication').value);
      showToast(res.ok ? 'Request sent to the creator' : (data.error || 'Could not send request'));
      if (res.ok) { el('fan-request-dedication').value=''; el('fan-request-track').value=''; }
    }
  });
}
