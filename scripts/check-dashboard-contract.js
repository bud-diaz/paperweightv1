'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'client', 'creator.html'), 'utf8');
const start = html.indexOf('<div id="dash-content"');
const end = html.indexOf('</div><!-- /dash-content -->');
if (start === -1 || end === -1) throw new Error('Could not locate #dash-content in creator.html');
const dashboardHtml = html.slice(start, end);

const htmlIds = [...dashboardHtml.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
const allHtmlIds = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
const counts = new Map();
htmlIds.forEach(id => counts.set(id, (counts.get(id) || 0) + 1));
const allCounts = new Map();
allHtmlIds.forEach(id => allCounts.set(id, (allCounts.get(id) || 0) + 1));

const dashboardDir = path.join(root, 'client', 'js', 'dashboard');
const sourceFiles = fs.readdirSync(dashboardDir)
  .filter(file => file.endsWith('.js'))
  .map(file => path.join(dashboardDir, file));
const queried = new Map();
for (const file of sourceFiles) {
  const source = fs.readFileSync(file, 'utf8');
  const patterns = [
    /\bel\(\s*['"]([^'"]+)['"]\s*\)/g,
    /getElementById\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const refs = queried.get(match[1]) || [];
      refs.push(path.relative(root, file));
      queried.set(match[1], refs);
    }
  }
}

const duplicates = [...counts].filter(([, count]) => count !== 1);
const runtimeCreatedIds = new Set(['sp-tags-options', 'btn-2fa-start']);
const missing = [...queried].filter(([id]) => !allCounts.has(id) && !runtimeCreatedIds.has(id));
const desktopOnlyCount = (dashboardHtml.match(/\bdata-desktop-only\b/g) || []).length;

if (process.argv.includes('--list')) {
  for (const [id, refs] of [...queried].sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`${id}\t${[...new Set(refs)].join(', ')}`);
  }
}

if (htmlIds.length !== 236) {
  throw new Error(`Expected 236 dashboard IDs, found ${htmlIds.length}`);
}
if (desktopOnlyCount !== 13) {
  throw new Error(`Expected 13 data-desktop-only placements, found ${desktopOnlyCount}`);
}
if (duplicates.length) {
  throw new Error(`Dashboard IDs are not unique: ${duplicates.map(([id, count]) => `${id} (${count})`).join(', ')}`);
}
if (missing.length) {
  throw new Error(`Queried dashboard IDs are missing: ${missing.map(([id]) => id).join(', ')}`);
}

const queriedDashboardIds = [...queried].filter(([id]) => counts.has(id)).length;
console.log(`Dashboard contract OK: ${htmlIds.length} unique IDs, ${queriedDashboardIds} queried dashboard IDs, ${desktopOnlyCount} desktop-only placements.`);
