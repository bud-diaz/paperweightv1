#!/usr/bin/env node
// Builds the hardened runtime tree consumed by electron-builder.
//
// The desktop installer should not copy raw first-party source directly from
// ../src and ../client. This script stages a runtime-only tree under
// electron/stage/ with minified first-party JS, bundled client assets, and the
// Electron-ABI better-sqlite3 native module.

'use strict';

const fs = require('fs');
const path = require('path');
const terser = require('terser');

const ROOT = path.resolve(__dirname, '..');
const ELECTRON_DIR = path.join(ROOT, 'electron');
const STAGE = path.join(ELECTRON_DIR, 'stage');
const WORK = path.join(ELECTRON_DIR, '.stage-work');
const STAGE_SRC = path.join(STAGE, 'src');
const STAGE_NODE_MODULES = path.join(STAGE, 'node_modules');

const CLIENT_DIR = path.join(ROOT, 'client');
const LANDING_DIR = path.join(ROOT, 'landing');
const WORK_CLIENT_DIR = path.join(WORK, 'client');
const WORK_LANDING_DIR = path.join(WORK, 'landing');
const HLS_SRC = path.join(ROOT, 'node_modules', 'hls.js', 'dist', 'hls.min.js');
const MATTER_SRC = path.join(ROOT, 'node_modules', 'matter-js', 'build', 'matter.min.js');
const ELECTRON_SQLITE = path.join(ELECTRON_DIR, 'native', 'node_modules', 'better-sqlite3');
const DOC_MANIFEST = require(path.join(ROOT, 'src', 'setup', 'docs-manifest'));

const GENERATED_SRC_BUNDLES = new Set([
  path.normalize('client-bundle.js'),
  path.normalize('native-bundle.js'),
  path.normalize('ffmpeg-bundle.js'),
]);

const FORBIDDEN_RUNTIME_MODULES = new Set([
  '.bin',
  '@babel',
  '@jridgewell',
  '@types',
  '@yao-pkg',
  'nodemon',
  'prebuild-install',
  'simple-update-notifier',
  'commander',
  'source-map-support',
  'terser',
  'touch',
  'undefsafe',
]);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.md': 'text/plain',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
};

function assertInside(parent, target) {
  const rel = path.relative(path.resolve(parent), path.resolve(target));
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Refusing to write outside ${parent}: ${target}`);
  }
}

function resetDir(dir, parent) {
  assertInside(parent, dir);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

function ensureFile(file, hint) {
  if (!fs.existsSync(file)) {
    throw new Error(`${file} not found${hint ? ` (${hint})` : ''}`);
  }
}

function stripSourceMapComment(text) {
  return text
    .replace(/\/\/[#@]\s*sourceMappingURL=.*$/gm, '')
    .replace(/\/\*[#@]\s*sourceMappingURL=[\s\S]*?\*\//g, '');
}

async function minifyJsFile(src, dest, rel) {
  const input = fs.readFileSync(src, 'utf8');
  const shebang = input.startsWith('#!') ? input.slice(0, input.indexOf('\n') + 1) : '';
  const code = shebang ? input.slice(shebang.length) : input;
  const result = await terser.minify(stripSourceMapComment(code), {
    compress: {
      passes: 2,
      drop_debugger: true,
    },
    mangle: {
      toplevel: false,
      keep_fnames: true,
    },
    format: {
      comments: false,
      ascii_only: true,
    },
    sourceMap: false,
  });

  if (result.error) throw result.error;
  if (!result.code) throw new Error(`Terser produced empty output for ${rel}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, shebang + result.code + '\n', 'utf8');
}

function minifyCssText(text) {
  return stripSourceMapComment(text)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{}:;,>+~])\s*/g, '$1')
    .trim();
}

function shouldSkipFirstParty(rel) {
  const normalized = path.normalize(rel);
  if (GENERATED_SRC_BUNDLES.has(normalized)) return true;
  const ext = path.extname(rel).toLowerCase();
  return ext === '.map' || ext === '.sql';
}

async function copyFirstPartyTree(srcDir, destDir, opts = {}) {
  const entries = fs.readdirSync(srcDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const src = path.join(srcDir, entry.name);
    const dest = path.join(destDir, entry.name);
    const rel = path.relative(opts.base || srcDir, src);

    if (entry.isDirectory()) {
      await copyFirstPartyTree(src, dest, { base: opts.base || srcDir });
      continue;
    }

    if (!entry.isFile() || shouldSkipFirstParty(rel)) continue;

    const ext = path.extname(entry.name).toLowerCase();
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (ext === '.js') {
      await minifyJsFile(src, dest, rel);
    } else if (ext === '.css') {
      fs.writeFileSync(dest, minifyCssText(fs.readFileSync(src, 'utf8')) + '\n', 'utf8');
    } else if (ext === '.html') {
      fs.writeFileSync(dest, stripSourceMapComment(fs.readFileSync(src, 'utf8')), 'utf8');
    } else {
      fs.copyFileSync(src, dest);
    }
  }
}

function copyDir(src, dest, filter) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const nextSrc = path.join(src, entry.name);
      const nextDest = path.join(dest, entry.name);
      if (filter && !filter(nextSrc, nextDest, entry)) continue;
      copyDir(nextSrc, nextDest, filter);
    }
  } else if (stat.isFile()) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

function copyRuntimeNodeModules() {
  const rootModules = path.join(ROOT, 'node_modules');
  ensureFile(rootModules, 'run npm install from the repo root first');
  resetDir(STAGE_NODE_MODULES, STAGE);

  copyDir(rootModules, STAGE_NODE_MODULES, (src, dest, entry) => {
    const rel = path.relative(rootModules, src);
    const first = rel.split(path.sep)[0];
    if (!rel) return true;
    if (FORBIDDEN_RUNTIME_MODULES.has(first)) return false;
    if (first === 'better-sqlite3') return false;
    if (entry.name === '.package-lock.json') return false;
    if (entry.name.endsWith('.map')) return false;
    return true;
  });

  copyDir(ELECTRON_SQLITE, path.join(STAGE_NODE_MODULES, 'better-sqlite3'));
}

function mimeFor(ext) {
  return MIME[ext.toLowerCase()] || 'application/octet-stream';
}

function walkFiles(dir, prefix) {
  const out = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const urlPath = prefix + '/' + entry.name;
    if (entry.isDirectory()) {
      out.push(...walkFiles(full, urlPath));
    } else if (entry.isFile()) {
      out.push({ full, urlPath });
    }
  }
  return out;
}

function buildClientBundle() {
  ensureFile(HLS_SRC, 'run npm install first');
  ensureFile(MATTER_SRC, 'run npm install first');

  const entries = walkFiles(WORK_CLIENT_DIR, '');
  if (fs.existsSync(WORK_LANDING_DIR)) {
    entries.push(...walkFiles(WORK_LANDING_DIR, '/landing'));
  }
  entries.push({ full: HLS_SRC, urlPath: '/vendor/hls.min.js' });
  entries.push({ full: MATTER_SRC, urlPath: '/vendor/matter.min.js' });
  // Root-level docs shown in the creator-mode Docs modal — outside client/
  // and landing/ (and their staged WORK_* copies), so read straight from
  // ROOT; plain text needs no minification/staging transform.
  for (const entry of DOC_MANIFEST) {
    entries.push({ full: path.join(ROOT, entry.file), urlPath: entry.urlPath });
  }

  const lines = [
    '// AUTO-GENERATED by scripts/build-desktop-runtime.js - do not edit by hand.',
    '',
    "'use strict';",
    '',
    'module.exports = {',
  ];

  for (const { full, urlPath } of entries) {
    const ext = path.extname(full);
    const data = ext === '.js' || ext === '.css' || ext === '.html' || ext === '.json' || ext === '.md'
      ? Buffer.from(stripSourceMapComment(fs.readFileSync(full, 'utf8')), 'utf8')
      : fs.readFileSync(full);
    const b64 = data.toString('base64');
    lines.push(`  ${JSON.stringify(urlPath)}:{data:Buffer.from(${JSON.stringify(b64)},'base64'),mime:${JSON.stringify(mimeFor(ext))}},`);
  }

  lines.push('};', '');
  fs.mkdirSync(STAGE_SRC, { recursive: true });
  fs.writeFileSync(path.join(STAGE_SRC, 'client-bundle.js'), lines.join('\n'), 'utf8');
  return entries.length;
}

function writeStagePackage() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const stagePkg = {
    name: pkg.name,
    version: pkg.version,
    private: true,
    main: 'src/index.js',
    dependencies: pkg.dependencies,
    paperweightDesktopRuntime: true,
  };
  fs.writeFileSync(path.join(STAGE, 'package.json'), JSON.stringify(stagePkg, null, 2) + '\n', 'utf8');
}

async function main() {
  ensureFile(CLIENT_DIR);
  ensureFile(path.join(ROOT, 'src', 'index.js'));
  ensureFile(path.join(ROOT, 'node_modules'), 'run npm install from the repo root first');
  ensureFile(ELECTRON_SQLITE, 'run npm run electron:rebuild from electron/ first');

  resetDir(STAGE, ELECTRON_DIR);
  resetDir(WORK, ELECTRON_DIR);

  await copyFirstPartyTree(path.join(ROOT, 'src'), STAGE_SRC);
  await copyFirstPartyTree(CLIENT_DIR, WORK_CLIENT_DIR);
  if (fs.existsSync(LANDING_DIR)) {
    await copyFirstPartyTree(LANDING_DIR, WORK_LANDING_DIR);
  }
  const clientEntries = buildClientBundle();
  copyRuntimeNodeModules();
  writeStagePackage();

  fs.rmSync(WORK, { recursive: true, force: true });

  console.log(`[Paperweight] Desktop runtime staged at ${STAGE}`);
  console.log(`[Paperweight] Client bundle entries: ${clientEntries}`);
}

main().catch(err => {
  console.error(`[Paperweight] Desktop runtime staging failed: ${err.stack || err.message}`);
  process.exit(1);
});
