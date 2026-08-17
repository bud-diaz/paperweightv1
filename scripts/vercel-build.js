#!/usr/bin/env node
// Vercel build step: copies the landing/ static pages into public/ so clean
// URLs (/, /download, /license, /content-responsibility, /listen) map to
// real files instead of relying on vercel.json rewrites, which have proven
// unreliable in production for this project.
//
// landing/*.html also references a couple of assets that live outside
// landing/ (the shared brand mark and the self-hosted font files), so those
// get copied in too — otherwise they 404 on the deployed site even though
// they resolve fine when served by the Express app.

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'landing');
const CLIENT = path.join(ROOT, 'client');
const OUT = path.join(ROOT, 'public');

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

for (const name of fs.readdirSync(SRC)) {
  if (name === 'vercel.json') continue;
  fs.copyFileSync(path.join(SRC, name), path.join(OUT, name));
}

fs.copyFileSync(path.join(CLIENT, 'brand-mark.png'), path.join(OUT, 'brand-mark.png'));
fs.cpSync(path.join(CLIENT, 'vendor', 'fonts'), path.join(OUT, 'vendor', 'fonts'), { recursive: true });

console.log(`Copied landing/ into public/: ${fs.readdirSync(OUT).join(', ')}`);
