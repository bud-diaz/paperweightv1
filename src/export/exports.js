// Shared listener/subscriber export queries + CSV formatting. Used by the
// dashboard's export routes (src/api/dashboard.js) and by the desktop
// uninstall flow (src/uninstall/runUninstall.js), which writes the same CSVs
// to disk instead of streaming them over HTTP.

const SUBSCRIBER_HEADERS = ['email', 'tier', 'provider', 'status', 'current_period_end', 'created_at'];
const LISTENER_HEADERS = ['email', 'created_at'];
const DOWNLOAD_LEAD_HEADERS = ['email', 'platform', 'updates_opt_in', 'created_at'];

// GET /api/dashboard/export/download-leads.csv
function getDownloadLeadRows(db) {
  return db.prepare(
    'SELECT email, platform, updates_opt_in, created_at FROM download_leads ORDER BY created_at DESC'
  ).all();
}

// GET /api/dashboard/export/subscribers.csv — listeners with an active subscription.
function getSubscriberRows(db) {
  return db.prepare(`
    SELECT la.email, s.tier, s.provider, s.status, s.current_period_end, la.created_at
    FROM listener_accounts la
    JOIN subscriptions s ON s.listener_id = la.id AND s.status = 'active'
    WHERE la.is_active = 1 AND la.email NOT LIKE '%@pending.paperweight.local'
    ORDER BY s.created_at DESC
  `).all();
}

// GET /api/dashboard/export/listeners.csv — every registered listener account.
function getListenerRows(db) {
  return db.prepare(`
    SELECT email, created_at FROM listener_accounts
    WHERE is_active = 1 AND email NOT LIKE '%@pending.paperweight.local'
    ORDER BY created_at DESC
  `).all();
}

// Values are formula-escaped so a hostile email like "=HYPERLINK(...)" can't
// execute when the CSV is opened in a spreadsheet.
function csvEscape(value) {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsvString(headers, rows) {
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map(h => csvEscape(row[h])).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

module.exports = {
  SUBSCRIBER_HEADERS,
  LISTENER_HEADERS,
  DOWNLOAD_LEAD_HEADERS,
  getDownloadLeadRows,
  getSubscriberRows,
  getListenerRows,
  csvEscape,
  toCsvString,
};
