#!/usr/bin/env node
// Vercel build step: copies the landing/ static pages into public/ so clean
// URLs (/, /download, /license, /content-responsibility, /listen) map to
// real files instead of relying on vercel.json rewrites, which have proven
// unreliable in production for this project.

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'landing');
const OUT = path.join(ROOT, 'public');

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

for (const name of fs.readdirSync(SRC)) {
  if (name === 'vercel.json') continue;
  fs.copyFileSync(path.join(SRC, name), path.join(OUT, name));
}

console.log(`Copied landing/ into public/: ${fs.readdirSync(OUT).join(', ')}`);
