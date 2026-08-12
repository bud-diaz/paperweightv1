/** Creator outcome surfaces: Today, Audience Memory, Release Autopilot,
 * Automations, Participation, and Station Ops. */
import * as api from '../api.js';
import { el, esc, showToast } from '../utils.js';
import { openSection } from './drawers.js';

let initialized = false;
let searchTimer = null;

function when(value) {
  if (!value) return 'Never';
  const date = new Date(String(value).includes('T') ? value : `${String(value).replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString([], { dateStyle:'medium', timeStyle:'short' });
}

function money(cents) { return `$${((Number(cents) || 0) / 100).toFixed(2)}`; }
function message(node, value, error = false) {
  if (!node) return;
  node.textContent = value || '';
  node.style.color = error ? '#ff6677' : '#39ff14';
}

export async function loadToday() {
  try {
    const data = await api.dashboard.today.get();
    const labels = { returningListeners:'RETURNING LISTENERS', optIns:'NEW OPT-INS', payments:'PAYMENT EVENTS', releases:'RELEASES SHIPPED' };
    el('today-outcomes').innerHTML = Object.entries(data.outcomes || {}).map(([key, value]) =>
      `<div class="necessity-outcome"><strong>${Number(value) || 0}</strong><span>${labels[key] || esc(key)}</span></div>`).join('');
    el('today-insights').innerHTML = data.insights?.length ? data.insights.map(insight => `
      <article class="necessity-card ${esc(insight.tone)}" data-insight-key="${esc(insight.key)}">
        <div class="necessity-kicker">${esc(insight.eyebrow)}</div>
        <div class="necessity-card-row"><div><h3>${esc(insight.title)}</h3><p>${esc(insight.body)}</p></div>
          <div class="necessity-actions">
            ${insight.action ? `<button class="mgmt-btn active" data-insight-action='${esc(JSON.stringify(insight.action))}'>${esc(insight.action.label)}</button>` : ''}
            <button class="mgmt-btn" data-insight-snooze="${esc(insight.key)}">7D</button>
            <button class="mgmt-btn" data-insight-dismiss="${esc(insight.key)}">×</button>
          </div>
        </div>
      </article>`).join('') : '<div class="necessity-empty">Nothing needs intervention. The station is doing its job.</div>';
  } catch { el('today-insights').innerHTML = '<div class="necessity-empty">The daily brief could not be loaded.</div>'; }
}

function personCard(person) {
  const support = Number(person.purchase_cents) ? `${money(person.purchase_cents)} direct support` : (Number(person.active_subscriptions) ? 'Active subscriber' : 'Listener');
  return `<button class="necessity-card necessity-person" data-profile-id="${person.profile_id}">
    <div class="necessity-card-row"><div><h3>${esc(person.display_name || person.email || 'Listener')}</h3>
      <p>${Number(person.listen_count) || 0} sessions · ${Math.round((Number(person.listen_seconds) || 0) / 60)} minutes · ${esc(support)}</p>
      <div class="necessity-meta">${person.favorite_title ? `FAVORITE: ${esc(person.favorite_title)} · ` : ''}LAST SEEN ${esc(when(person.last_listen_at || person.last_seen_at))}</div>
    </div></div></button>`;
}

async function renderPeople(promise) {
  const host = el('audience-people');
  host.innerHTML = '<div class="necessity-empty">Reading the relationship ledger…</div>';
  try {
    const data = await promise;
    const people = data.people || [];
    host.innerHTML = people.length ? people.map(personCard).join('') : '<div class="necessity-empty">No listeners match this view yet.</div>';
  } catch { host.innerHTML = '<div class="necessity-empty">Audience Memory could not be loaded.</div>'; }
}

export async function loadAudience() {
  try {
    const data = await api.dashboard.audienceMemory.segments();
    el('audience-segments').innerHTML = `<button class="necessity-chip active" data-audience-all>ALL</button>` +
      (data.segments || []).map(segment => `<button class="necessity-chip" data-audience-segment="${esc(segment.key)}">${esc(segment.label)} <b>${Number(segment.count) || 0}</b></button>`).join('');
  } catch {}
  await renderPeople(api.dashboard.audienceMemory.people(el('audience-search')?.value || ''));
}

async function loadPerson(id) {
  try {
    const person = await api.dashboard.audienceMemory.person(id);
    document.querySelectorAll('.necessity-person').forEach(node => node.classList.toggle('selected', node.dataset.profileId === String(id)));
    el('audience-detail').innerHTML = `
      <div class="necessity-profile"><div class="necessity-kicker">RELATIONSHIP RECORD</div><h3>${esc(person.display_name || person.email || 'Listener')}</h3>
        <p>${esc(person.email || person.account_email || 'No email')} · ${person.marketing_opt_in ? 'OPTED IN' : 'NO MARKETING CONSENT'}</p>
        <div class="necessity-meta">${Number(person.listen_count) || 0} LISTENS · ${money(person.purchase_cents)} SUPPORT · ${Number(person.active_days_30) || 0} ACTIVE DAYS / 30</div></div>
      <div class="necessity-timeline">${person.timeline?.length ? person.timeline.map(event => `
        <div class="necessity-event"><strong>${esc(String(event.type || 'activity').replaceAll('_',' '))}</strong>${event.media_title ? ` · ${esc(event.media_title)}` : ''}${event.seconds ? ` · ${Math.round(event.seconds / 60)} min` : ''}${event.value_cents ? ` · ${money(event.value_cents)}` : ''}
        <time>${esc(when(event.occurred_at))}${event.source ? ` · ${esc(event.source)}` : ''}</time></div>`).join('') : '<div class="necessity-empty">No recorded activity yet.</div>'}</div>`;
  } catch { el('audience-detail').innerHTML = '<div class="necessity-empty">This relationship record could not be loaded.</div>'; }
}

async function loadReleaseTracks() {
  try {
    const items = await api.dashboard.media.list();
    el('release-items').innerHTML = items.filter(item => item.is_active !== 0 && !String(item.filepath || '').startsWith('external://')).map(item =>
      `<option value="${item.id}">${esc(item.title || item.filename)} · ${esc(item.visibility || 'public')}</option>`).join('');
  } catch {}
}

export async function loadReleases() {
  try {
    const data = await api.dashboard.releases.list();
    el('release-list').innerHTML = data.releases?.length ? data.releases.map(release => `
      <article class="necessity-card ${esc(release.status)}" data-release-id="${release.id}">
        <div class="necessity-card-row"><div><h3>${esc(release.title)}</h3><p>${Number(release.item_count) || 0} track${Number(release.item_count) === 1 ? '' : 's'} · ${esc(release.visibility)} · ${esc(when(release.release_at))}</p>${release.last_error ? `<div class="necessity-meta">${esc(release.last_error)}</div>` : ''}</div>
          <span class="necessity-status ${esc(release.status)}">${esc(release.status)}</span></div>
        <div class="necessity-actions">
          ${['scheduled','failed'].includes(release.status) ? `<button class="mgmt-btn active" data-release-publish="${release.id}">PUBLISH NOW</button><button class="mgmt-btn danger" data-release-cancel="${release.id}">CANCEL</button>` : ''}
          ${release.status === 'published' ? `<button class="mgmt-btn" data-release-report="${release.id}">VIEW OUTCOME</button>` : ''}
        </div><div class="necessity-note" data-release-report-host="${release.id}" hidden></div>
      </article>`).join('') : '<div class="necessity-empty">No release campaigns yet. Bundle the tracks, announcement, premiere, and notifications into one schedule.</div>';
  } catch { el('release-list').innerHTML = '<div class="necessity-empty">The release calendar could not be loaded.</div>'; }
}

export async function loadAutomations() {
  try {
    const data = await api.dashboard.automations.get();
    el('automations-paused').checked = !!data.paused;
    el('automation-rules').innerHTML = (data.rules || []).map(rule => `
      <article class="necessity-card ${rule.enabled ? 'positive' : ''}"><div class="necessity-card-row"><div><h3>${esc(rule.name)}</h3><p>${esc(rule.description)}</p><div class="necessity-meta">TRIGGER: ${esc(rule.trigger)} · ${rule.marketing ? 'CONSENT REQUIRED' : 'TRANSACTIONAL'}</div></div>
        <div class="necessity-actions"><label class="necessity-switch"><input type="checkbox" data-automation-enabled="${rule.id}" ${rule.enabled ? 'checked' : ''}/> ON</label>
          <select class="dash-select" data-automation-mode="${rule.id}"><option value="draft" ${rule.mode === 'draft' ? 'selected' : ''}>RECOMMEND</option><option value="automatic" ${rule.mode === 'automatic' ? 'selected' : ''}>AUTOMATIC</option></select></div></div></article>`).join('');
    el('automation-runs').innerHTML = data.runs?.length ? data.runs.slice(0,30).map(run => `
      <article class="necessity-card ${esc(run.status)}"><div class="necessity-card-row"><div><h3>${esc(run.display_name || run.template_key?.replaceAll('_',' ') || 'Automation')}</h3><p>${esc(run.explanation || '')}</p><div class="necessity-meta">${esc(when(run.created_at))}${run.last_error ? ` · ${esc(run.last_error)}` : ''}</div></div><div class="necessity-actions"><span class="necessity-status ${esc(run.status)}">${esc(run.status)}</span>${run.status === 'recommended' ? `<button class="mgmt-btn active" data-automation-send="${run.id}">SEND</button>` : ''}</div></div></article>`).join('') : '<div class="necessity-empty">No automation decisions yet. Paperweight will explain every recommendation before it sends.</div>';
  } catch {
    el('automation-rules').innerHTML = '<div class="necessity-empty">Automations could not be loaded.</div>';
  }
}

export async function loadParticipation() {
  try {
    const [requestData, pollData] = await Promise.all([api.dashboard.participation.requests(), api.dashboard.participation.polls()]);
    el('participation-polls').innerHTML = pollData.polls?.length ? pollData.polls.map(poll => `
      <article class="necessity-card"><div class="necessity-card-row"><div><h3>${esc(poll.question)}</h3><p>${(poll.options || []).map(option => `${esc(option.label)} ${Number(option.votes) || 0}`).join(' · ')}</p></div><div class="necessity-actions"><span class="necessity-status ${esc(poll.status)}">${esc(poll.status)}</span>${poll.status !== 'open' ? `<button class="mgmt-btn active" data-poll-status="open" data-poll-id="${poll.id}">OPEN</button>` : `<button class="mgmt-btn" data-poll-status="closed" data-poll-id="${poll.id}">CLOSE</button>`}</div></div></article>`).join('') : '<div class="necessity-empty">No polls yet.</div>';
    el('participation-requests').innerHTML = requestData.requests?.length ? requestData.requests.map(request => `
      <article class="necessity-card"><div class="necessity-card-row"><div><h3>${esc(request.media_title)}</h3><p>${esc(request.listener_name)}${request.dedication ? ` · “${esc(request.dedication)}”` : ''}</p><div class="necessity-meta">${esc(when(request.created_at))}</div></div><div class="necessity-actions"><span class="necessity-status ${esc(request.status)}">${esc(request.status)}</span>${request.status === 'pending' ? `<button class="mgmt-btn active" data-request-status="accepted" data-request-id="${request.id}">QUEUE</button><button class="mgmt-btn" data-request-status="declined" data-request-id="${request.id}">DECLINE</button>` : ''}${request.status === 'accepted' ? `<button class="mgmt-btn" data-request-status="played" data-request-id="${request.id}">MARK PLAYED</button>` : ''}</div></div></article>`).join('') : '<div class="necessity-empty">No listener requests yet.</div>';
  } catch {}
}

export async function loadOps() {
  try {
    const data = await api.dashboard.ops.get();
    const backup = data.latestBackup;
    el('ops-summary').innerHTML = `
      <div class="necessity-outcome"><strong>${data.broadcastAvailabilityPct == null ? '—' : `${data.broadcastAvailabilityPct}%`}</strong><span>30D OBSERVED AVAILABILITY</span></div>
      <div class="necessity-outcome"><strong>${(data.checks || []).filter(check => check.status === 'ok').length}/${(data.checks || []).length}</strong><span>CHECKS PASSING</span></div>
      <div class="necessity-outcome"><strong>${backup?.verified_at ? 'YES' : 'NO'}</strong><span>LATEST BACKUP VERIFIED</span></div>
      <div class="necessity-outcome"><strong>${backup?.size_bytes ? `${Math.ceil(backup.size_bytes / 1024)}K` : '—'}</strong><span>BACKUP SIZE</span></div>`;
    el('ops-checks').innerHTML = data.checks?.length ? data.checks.map(check => `<article class="necessity-card ${esc(check.status)}"><div class="necessity-card-row"><div><h3>${esc(check.check_type)}</h3><div class="necessity-meta">${esc(when(check.checked_at))}</div></div><span class="necessity-status ${esc(check.status)}">${esc(check.status)}</span></div></article>`).join('') : '<div class="necessity-empty">No checks have run yet. Run checks to establish a baseline.</div>';
    el('ops-auto-backup').checked = !!data.autoBackup;
    message(el('ops-msg'), backup ? `Latest backup: ${backup.backup_path || 'pending'} · ${backup.verified_at ? `verified ${when(backup.verified_at)}` : backup.status}` : 'No backup created yet.');
  } catch { message(el('ops-msg'), 'Station Ops could not be loaded.', true); }
}

export function load() {
  loadToday();
  loadAudience();
  loadReleaseTracks();
  loadReleases();
  loadAutomations();
  loadParticipation();
  loadOps();
}

export function init() {
  if (initialized) return;
  initialized = true;
  el('btn-today-refresh')?.addEventListener('click', loadToday);
  el('today-insights')?.addEventListener('click', async event => {
    const actionButton = event.target.closest('[data-insight-action]');
    if (actionButton) {
      const action = JSON.parse(actionButton.dataset.insightAction);
      if (action.drawer) openSection(action.drawer, { animate:true });
      if (action.segment) {
        document.querySelectorAll('.necessity-chip').forEach(node => node.classList.toggle('active', node.dataset.audienceSegment === action.segment));
        await renderPeople(api.dashboard.audienceMemory.segment(action.segment));
      }
      return;
    }
    const snooze = event.target.closest('[data-insight-snooze]');
    const dismiss = event.target.closest('[data-insight-dismiss]');
    if (snooze || dismiss) {
      await api.dashboard.today.setState((snooze || dismiss).dataset.insightSnooze || dismiss.dataset.insightDismiss, snooze ? 'snoozed' : 'dismissed', 7);
      loadToday();
    }
  });
  el('audience-search')?.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => renderPeople(api.dashboard.audienceMemory.people(el('audience-search').value)), 220); });
  el('audience-segments')?.addEventListener('click', event => {
    const chip = event.target.closest('.necessity-chip'); if (!chip) return;
    document.querySelectorAll('.necessity-chip').forEach(node => node.classList.toggle('active', node === chip));
    renderPeople(chip.dataset.audienceSegment ? api.dashboard.audienceMemory.segment(chip.dataset.audienceSegment) : api.dashboard.audienceMemory.people(el('audience-search').value));
  });
  el('audience-people')?.addEventListener('click', event => { const person = event.target.closest('[data-profile-id]'); if (person) loadPerson(person.dataset.profileId); });

  el('btn-release-new')?.addEventListener('click', () => { el('release-form').hidden = !el('release-form').hidden; });
  el('btn-release-cancel-form')?.addEventListener('click', () => { el('release-form').hidden = true; });
  el('release-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const itemIds = [...el('release-items').selectedOptions].map(option => Number(option.value));
    const body = { title:el('release-title').value, releaseAt:new Date(el('release-at').value).toISOString(), visibility:el('release-visibility').value, itemIds,
      postTitle:el('release-post-title').value, postBody:el('release-post-body').value, setHighlight:el('release-highlight').checked,
      queuePremiere:el('release-premiere').checked, notifyWebhook:el('release-webhook').checked, notifySupporters:el('release-supporters').checked };
    const { res, data } = await api.dashboard.releases.create(body);
    message(el('release-form-msg'), res.ok ? 'Scheduled.' : (data.error || 'Could not schedule.'), !res.ok);
    if (res.ok) { event.target.reset(); el('release-highlight').checked = true; el('release-webhook').checked = true; el('release-form').hidden = true; loadReleases(); loadToday(); }
  });
  el('release-list')?.addEventListener('click', async event => {
    const publish = event.target.closest('[data-release-publish]');
    const cancel = event.target.closest('[data-release-cancel]');
    const report = event.target.closest('[data-release-report]');
    if (publish) { const { res, data } = await api.dashboard.releases.publish(publish.dataset.releasePublish); showToast(res.ok ? 'Release published' : (data.error || 'Publish failed')); loadReleases(); loadToday(); }
    if (cancel) { const { res, data } = await api.dashboard.releases.cancel(cancel.dataset.releaseCancel); showToast(res.ok ? 'Release cancelled' : (data.error || 'Cancel failed')); loadReleases(); }
    if (report) { const data = await api.dashboard.releases.report(report.dataset.releaseReport); const host = document.querySelector(`[data-release-report-host="${report.dataset.releaseReport}"]`); host.hidden = false; host.textContent = `${data.plays} starts · ${data.completions} completions · ${data.gateViews} gate views · ${data.unlocks} unlocks · ${money(data.revenueCents)}`; }
  });

  el('automations-paused')?.addEventListener('change', async event => { await api.dashboard.automations.pause(event.target.checked); loadAutomations(); });
  el('automation-rules')?.addEventListener('change', async event => {
    const enabled = event.target.closest('[data-automation-enabled]'); const mode = event.target.closest('[data-automation-mode]');
    if (enabled) await api.dashboard.automations.updateRule(enabled.dataset.automationEnabled, { enabled:enabled.checked });
    if (mode) await api.dashboard.automations.updateRule(mode.dataset.automationMode, { mode:mode.value });
    loadAutomations();
  });
  el('automation-runs')?.addEventListener('click', async event => { const send = event.target.closest('[data-automation-send]'); if (!send) return; const { res, data } = await api.dashboard.automations.send(send.dataset.automationSend); showToast(res.ok ? 'Delivery queued' : (data.error || 'Could not queue')); loadAutomations(); });
  el('btn-automation-sweep')?.addEventListener('click', async () => { const { data } = await api.dashboard.automations.sweep(); showToast(`${data.created || 0} recommendations created`); loadAutomations(); });

  el('btn-poll-create')?.addEventListener('click', async () => { const options = el('poll-options').value.split(',').map(value => value.trim()).filter(Boolean); const { res, data } = await api.dashboard.participation.createPoll({ question:el('poll-question').value, options }); showToast(res.ok ? 'Poll drafted' : (data.error || 'Could not create poll')); if (res.ok) { el('poll-question').value=''; el('poll-options').value=''; loadParticipation(); } });
  el('participation-polls')?.addEventListener('click', async event => { const button=event.target.closest('[data-poll-status]'); if (!button) return; await api.dashboard.participation.setPollStatus(button.dataset.pollId,button.dataset.pollStatus); loadParticipation(); });
  el('participation-requests')?.addEventListener('click', async event => { const button=event.target.closest('[data-request-status]'); if (!button) return; const { res, data }=await api.dashboard.participation.updateRequest(button.dataset.requestId,button.dataset.requestStatus); showToast(res.ok ? 'Request updated' : (data.error || 'Could not update')); loadParticipation(); });

  el('btn-ops-check')?.addEventListener('click', async () => { message(el('ops-msg'),'Running station checks…'); await api.dashboard.ops.check(); loadOps(); });
  el('btn-ops-backup')?.addEventListener('click', async () => { message(el('ops-msg'),'Creating and verifying backup…'); const { res, data }=await api.dashboard.ops.backup(); message(el('ops-msg'),res.ok ? 'Verified backup complete.' : (data.error || 'Backup failed.'),!res.ok); loadOps(); });
  el('ops-auto-backup')?.addEventListener('change', async event => { await api.dashboard.ops.settings(event.target.checked); loadOps(); });
}
