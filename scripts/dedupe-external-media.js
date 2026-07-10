#!/usr/bin/env node
// One-off cleanup for duplicate media rows created by the external-import
// endpoint (POST /api/dashboard/media/external) before it deduped on
// (source_platform, external_url). For each duplicate group, keeps the
// oldest row and deactivates the rest (is_active = 0) so they disappear
// from the library without deleting data.
//
//   node scripts/dedupe-external-media.js         # dry run, prints what would change
//   node scripts/dedupe-external-media.js --apply # actually deactivate duplicates

process.env.PAPERWEIGHT_ALLOW_MISSING_ENV = process.env.PAPERWEIGHT_ALLOW_MISSING_ENV || 'true';

const { initDb, getDb, closeDb } = require('../src/db');

const APPLY = process.argv.includes('--apply');

function main() {
  initDb();
  const db = getDb();

  const groups = db.prepare(`
    SELECT source_platform, external_url, COUNT(*) AS n
    FROM media
    WHERE source_platform IS NOT NULL AND external_url IS NOT NULL AND is_active = 1
    GROUP BY source_platform, external_url
    HAVING n > 1
  `).all();

  if (groups.length === 0) {
    console.log('No duplicate external media rows found.');
    return;
  }

  const listStmt = db.prepare(`
    SELECT id, title, indexed_at FROM media
    WHERE source_platform = ? AND external_url = ? AND is_active = 1
    ORDER BY indexed_at ASC, id ASC
  `);
  const deactivateStmt = db.prepare(`UPDATE media SET is_active = 0 WHERE id = ?`);

  let totalDeactivated = 0;

  for (const group of groups) {
    const rows = listStmt.all(group.source_platform, group.external_url);
    const [keep, ...dupes] = rows;
    console.log(`\n${group.source_platform} ${group.external_url} (${rows.length} copies)`);
    console.log(`  keep:       #${keep.id} "${keep.title}" (${keep.indexed_at})`);
    for (const dupe of dupes) {
      console.log(`  deactivate: #${dupe.id} "${dupe.title}" (${dupe.indexed_at})`);
      if (APPLY) deactivateStmt.run(dupe.id);
      totalDeactivated++;
    }
  }

  console.log(`\n${groups.length} duplicate group(s), ${totalDeactivated} row(s) ${APPLY ? 'deactivated' : 'would be deactivated'}.`);
  if (!APPLY) console.log('Dry run only. Re-run with --apply to make changes.');

  closeDb();
}

main();
