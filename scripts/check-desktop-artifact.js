#!/usr/bin/env node
// Verifies that the Electron runtime staging tree and any unpacked build
// resources do not contain obvious reverse-engineering footguns.

'use strict';

const fs = require('fs');
const path = require('path');
const { parseOptions } = require('./lib/binary-target');

const OPTIONS = parseOptions(process.argv.slice(2));
const ROOT = path.resolve(process.env.PAPERWEIGHT_ARTIFACT_ROOT || path.resolve(__dirname, '..'));
const ELECTRON_DIR = path.join(ROOT, 'electron');
const STAGE = path.join(ELECTRON_DIR, 'stage');
const EXPECTED_PLATFORM = OPTIONS.platform || null;

let ok = true;

function pass(msg) {
  console.log(`OK   ${msg}`);
}

function fail(msg) {
  console.log(`FAIL ${msg}`);
  ok = false;
}

function exists(rel) {
  return fs.existsSync(path.join(STAGE, rel));
}

function readPngInfo(file) {
  const buf = fs.readFileSync(file);
  const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length < 33 || buf.slice(0, 8).compare(pngSig) !== 0) {
    throw new Error('not a PNG');
  }
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    colorType: buf[25],
  };
}

function checkPng(rel, size, label) {
  const full = path.join(ELECTRON_DIR, rel);
  if (!fs.existsSync(full)) {
    fail(`${label} missing: electron/${rel}`);
    return;
  }

  try {
    const info = readPngInfo(full);
    if (info.width === size && info.height === size) {
      pass(`${label}: ${size}x${size}`);
    } else {
      fail(`${label} should be ${size}x${size}, found ${info.width}x${info.height}`);
    }
  } catch (err) {
    fail(`${label} invalid PNG: ${err.message}`);
  }
}

function checkContainerIcon(rel, magic, label) {
  const full = path.join(ELECTRON_DIR, rel);
  if (!fs.existsSync(full)) {
    fail(`${label} missing: electron/${rel}`);
    return;
  }
  const head = fs.readFileSync(full).slice(0, magic.length);
  if (head.compare(Buffer.from(magic, 'binary')) === 0) pass(`${label} exists`);
  else fail(`${label} has unexpected file header`);
}

function walk(dir, visit) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    visit(full, entry);
    if (entry.isDirectory()) walk(full, visit);
  }
}

function checkMissing(rel, label) {
  if (exists(rel)) pass(label || `${rel} exists`);
  else fail(`${label || rel} missing`);
}

function checkAbsent(rel, label) {
  if (exists(rel)) fail(`${label || rel} should not be staged`);
  else pass(`${label || rel} absent`);
}

function checkNoSourceMaps(dir, label) {
  const offenders = [];
  walk(dir, full => {
    if (full.endsWith('.map')) offenders.push(path.relative(ROOT, full));
    if (/\.(js|css|html)$/i.test(full)) {
      const text = fs.readFileSync(full, 'utf8');
      if (/sourceMappingURL=/.test(text)) offenders.push(`${path.relative(ROOT, full)} (sourceMappingURL)`);
    }
  });
  if (offenders.length) fail(`${label} contains source map references: ${offenders.slice(0, 5).join(', ')}`);
  else pass(`${label} has no source maps`);
}

function checkIconAssets() {
  const electronPkg = JSON.parse(fs.readFileSync(path.join(ELECTRON_DIR, 'package.json'), 'utf8'));
  if (electronPkg.build?.win?.icon === 'build/icon.ico') {
    pass('Windows executable icon config uses Paperweight ICO');
  } else {
    fail('Windows executable icon config should use build/icon.ico');
  }

  for (const field of ['installerIcon', 'uninstallerIcon', 'installerHeaderIcon']) {
    if (electronPkg.build?.nsis?.[field] === 'build/icon.ico') {
      pass(`Windows NSIS ${field} uses Paperweight ICO`);
    } else {
      fail(`Windows NSIS ${field} should use build/icon.ico`);
    }
  }

  if (electronPkg.build?.linux?.icon === 'build/icons') {
    pass('Linux Electron icon config uses build/icons icon set');
  } else {
    fail('Linux Electron icon config should use build/icons so hicolor icon sizes resolve');
  }

  checkPng(path.join('build', 'icon.png'), 512, 'desktop app PNG icon');
  checkPng(path.join('build', 'tray-icon.png'), 32, 'tray PNG icon');
  checkPng(path.join('build', 'tray-icon@2x.png'), 64, 'tray @2x PNG icon');

  for (const size of [16, 24, 32, 48, 64, 128, 256, 512]) {
    checkPng(path.join('build', 'icons', `${size}x${size}.png`), size, `Linux hicolor icon ${size}`);
  }

  checkContainerIcon(path.join('build', 'icon.ico'), '\x00\x00\x01\x00', 'Windows ICO icon');
  checkContainerIcon(path.join('build', 'icon.icns'), 'icns', 'macOS ICNS icon');
}

function checkStage() {
  if (!fs.existsSync(STAGE)) {
    fail('electron/stage missing; run npm run build:desktop-runtime');
    return;
  }

  checkMissing('src/index.js', 'staged server entry');
  checkMissing('src/client-bundle.js', 'staged bundled client assets');
  checkMissing('node_modules/express/package.json', 'staged runtime dependencies');
  checkMissing('node_modules/better-sqlite3/build/Release/better_sqlite3.node', 'staged Electron SQLite native binding');
  checkMissing('package.json', 'staged runtime package.json');

  checkAbsent('client', 'raw client directory');
  checkAbsent('landing', 'raw landing directory');
  checkAbsent('node_modules/.bin', 'npm bin shims');
  checkAbsent('node_modules/@yao-pkg', 'pkg build tool');
  checkAbsent('node_modules/nodemon', 'nodemon dev tool');
  checkAbsent('node_modules/prebuild-install', 'prebuild-install build helper');
  checkAbsent('node_modules/terser', 'terser build tool');
  checkAbsent('node_modules/commander', 'commander build helper');
  checkAbsent('node_modules/source-map-support', 'source-map-support build helper');
  checkAbsent('src/native-bundle.js', 'pkg native bundle');
  checkAbsent('src/ffmpeg-bundle.js', 'pkg ffmpeg bundle');

  checkNoSourceMaps(path.join(STAGE, 'src'), 'staged first-party runtime');
}

function matchesPlatformDir(name, platform) {
  if (!platform) return true;
  const normalized = name.toLowerCase();
  if (platform === 'win32') return normalized.startsWith('win');
  if (platform === 'linux') return normalized.startsWith('linux');
  if (platform === 'darwin') return normalized.startsWith('mac') || normalized.startsWith('darwin');
  throw new Error(`Unsupported artifact platform: ${platform}`);
}

function resourceDirsFromDist(expectedPlatform = EXPECTED_PLATFORM, electronDir = ELECTRON_DIR) {
  const dist = path.join(electronDir, 'dist');
  const resources = [];
  if (!fs.existsSync(dist)) return resources;

  // Only the app's own Electron resources directory matters here:
  //   - win/linux unpacked builds: <platformDir>/resources
  //   - mac app bundles: <platformDir>/<Name>.app/Contents/Resources
  // A generic recursive search for any directory literally named
  // "resources" also picks up unrelated bundles that happen to share the
  // name (npm packages under node_modules, Electron's own macOS framework
  // bundles under Contents/Frameworks/*.framework/Versions/A/Resources),
  // so this only ever looks at those two known, fixed-depth locations.
  for (const entry of fs.readdirSync(dist, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (!matchesPlatformDir(entry.name, expectedPlatform)) continue;
    const platformDir = path.join(dist, entry.name);

    const unpackedResources = path.join(platformDir, 'resources');
    if (fs.existsSync(unpackedResources)) resources.push(unpackedResources);

    for (const sub of fs.readdirSync(platformDir, { withFileTypes: true })) {
      if (sub.isDirectory() && sub.name.endsWith('.app')) {
        const appResources = path.join(platformDir, sub.name, 'Contents', 'Resources');
        if (fs.existsSync(appResources)) resources.push(appResources);
      }
    }
  }
  return resources;
}

function resourceIssues(dir) {
  const forbidden = [
    'client',
    'landing',
    path.join('node_modules', '.bin'),
    path.join('node_modules', '@yao-pkg'),
    path.join('node_modules', 'nodemon'),
    path.join('node_modules', 'prebuild-install'),
    path.join('node_modules', 'terser'),
    path.join('node_modules', 'commander'),
    path.join('node_modules', 'source-map-support'),
    path.join('src', 'native-bundle.js'),
    path.join('src', 'ffmpeg-bundle.js'),
  ];
  const issues = forbidden
    .filter(name => fs.existsSync(path.join(dir, name)))
    .map(name => `contains forbidden runtime path ${name}`);
  if (!fs.existsSync(path.join(dir, 'src', 'client-bundle.js'))) issues.push('missing src/client-bundle.js');
  walk(path.join(dir, 'src'), full => {
    if (full.endsWith('.map')) issues.push(`contains source map: ${full}`);
    if (/\.(js|css|html)$/i.test(full) && /sourceMappingURL=/.test(fs.readFileSync(full, 'utf8'))) {
      issues.push(`contains source map reference: ${full}`);
    }
  });
  return issues;
}

function checkBuiltResources(expectedPlatform = EXPECTED_PLATFORM) {
  const resources = resourceDirsFromDist(expectedPlatform);
  if (!resources.length) {
    if (expectedPlatform) fail(`no unpacked Electron resources found for ${expectedPlatform}`);
    else pass('no unpacked Electron resources found to inspect');
    return;
  }

  for (const dir of resources) {
    const rel = path.relative(ROOT, dir);
    const issues = resourceIssues(dir);
    if (issues.length) issues.forEach(issue => fail(`${rel} ${issue}`));
    else pass(`${rel} runtime resources validated`);
  }
}

function main() {
  checkIconAssets();
  checkStage();
  checkBuiltResources();
  if (!ok) process.exitCode = 1;
  else console.log('Desktop artifact hardening check passed.');
}

if (require.main === module) main();

module.exports = { main, matchesPlatformDir, resourceDirsFromDist, resourceIssues };
