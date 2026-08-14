#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TARGETS = ['client', 'landing', 'docs', 'README.md', 'RELEASE_CHECKLIST.md', 'AGENTS.md'];
const ALLOWED_FILES = new Set([
  'docs/system-pape-contract.md',
  'docs/system-pape-directory.md',
  'docs/plans/2026-08-13-system-pape-alignment.md',
]);

const ALLOW_PATTERNS = [
  /System\.Pape/i,
  /system\.pape/i,
  /vault_projects?/i,
  /vault_project_items?/i,
  /project_id/i,
  /project unlock/i,
  /projects? module/i,
  /internal (operating )?workstreams?/i,
  /legacy\/internal/i,
  /legacy DB/i,
  /implementation name/i,
  /Do not confuse/i,
  /Terminology Guardrail/i,
  /Paperweight vault project/i,
  /System\.Pape project/i,
  /project root/i,
  /GitHub project/i,
  /media project manager/i,
  /Project Layout/i,
  /per-project open state/i,
  /LIBRARY_STRUCTURE\.projects/i,
  /#hl-tog-project/i,
];

function walk(entry) {
  const abs = path.join(ROOT, entry);
  if (!fs.existsSync(abs)) return [];
  const stat = fs.statSync(abs);
  if (stat.isFile()) return [abs];
  const out = [];
  for (const name of fs.readdirSync(abs)) {
    if (name.startsWith('.')) continue;
    const child = path.join(abs, name);
    const rel = path.relative(ROOT, child).replace(/\\/g, '/');
    if (/node_modules|dist|build|client\/app\/assets/.test(rel)) continue;
    const childStat = fs.statSync(child);
    if (childStat.isDirectory()) out.push(...walk(rel));
    else out.push(child);
  }
  return out;
}

const files = TARGETS.flatMap(walk).filter(file => /\.(html|md)$/.test(file));
const hits = [];

for (const file of files) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, idx) => {
    if (!/\bprojects?\b/i.test(line)) return;
    if (ALLOWED_FILES.has(rel) || rel.startsWith('docs/plans/')) return;
    if (ALLOW_PATTERNS.some(re => re.test(line))) return;
    hits.push(`${rel}:${idx + 1}: ${line.trim()}`);
  });
}

if (hits.length) {
  console.error('Terminology check failed: public-facing Paperweight copy may be using "project(s)" where "collection(s)" is intended.');
  console.error(hits.join('\n'));
  process.exit(1);
}

console.log(`Terminology check passed (${files.length} files scanned).`);
