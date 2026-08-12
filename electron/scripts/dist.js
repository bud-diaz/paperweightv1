#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ELECTRON_DIR = path.resolve(__dirname, '..');
const ROOT = path.resolve(ELECTRON_DIR, '..');
const DIST = path.join(ELECTRON_DIR, 'dist');
const TARGETS = Object.freeze({ win32: 'win32', windows: 'win32', darwin: 'darwin', mac: 'darwin', macos: 'darwin', linux: 'linux' });

function selectPlatform(args, host = process.platform) {
  const index = args.indexOf('--target');
  const requested = index === -1 ? host : TARGETS[String(args[index + 1] || '').toLowerCase()];
  if (!requested) throw new Error('Expected --target win32, darwin, or linux');
  if (requested !== host) throw new Error(`Cannot build ${requested} Electron artifacts on ${host}`);
  return requested;
}

function cleanDist(dist = DIST, electronDir = ELECTRON_DIR) {
  const relative = path.relative(path.resolve(electronDir), path.resolve(dist));
  if (relative !== 'dist') throw new Error(`Refusing to clean unsafe path: ${dist}`);
  fs.rmSync(dist, { recursive: true, force: true });
}

function run(command, args, cwd = ELECTRON_DIR) {
  console.log(`  $ ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', windowsHide: true });
  if (result.status !== 0) throw new Error(`${command} failed (exit ${result.status ?? 'unknown'})`);
}

function resolveBuilderCli() {
  // Resolved lazily (and tolerant of a missing module) so commandsFor() stays
  // callable for its command-shape metadata — e.g. from
  // test/build-scripts.test.js — on hosts that only installed root
  // node_modules and never ran `npm ci` inside electron/. A real desktop
  // build always has electron/node_modules present, so this still resolves
  // to the real CLI when it matters; spawnSync surfaces a clear ENOENT if it
  // somehow doesn't.
  try {
    return require.resolve('electron-builder/cli.js', { paths: [ELECTRON_DIR] });
  } catch {
    return path.join(ELECTRON_DIR, 'node_modules', 'electron-builder', 'cli.js');
  }
}

function commandsFor(platform) {
  const builderCli = resolveBuilderCli();
  const rebuildScript = path.join(ELECTRON_DIR, 'scripts', 'rebuild-native.js');
  const commands = [
    [process.execPath, [path.join(ELECTRON_DIR, 'scripts', 'generate-icons.js')]],
    [process.execPath, [rebuildScript]],
  ];
  if (platform === 'darwin') {
    commands.push([process.execPath, [rebuildScript, '--arch', 'arm64']]);
    commands.push([process.execPath, [rebuildScript, '--arch', 'x64']]);
  }
  commands.push([process.execPath, [path.join(ROOT, 'scripts', 'build-desktop-runtime.js')]]);
  commands.push([process.execPath, [path.join(ROOT, 'scripts', 'stage-electron-ffmpeg.js'), '--platform', platform]]);
  commands.push([process.execPath, [path.join(ROOT, 'scripts', 'stage-electron-cloudflared.js'), '--platform', platform]]);
  commands.push([process.execPath, [path.join(ROOT, 'scripts', 'stage-electron-frp.js'), '--platform', platform]]);
  if (platform === 'darwin') {
    commands.push([process.execPath, [builderCli, '--config', 'electron-builder.universal.json', '--mac']]);
  } else {
    commands.push([process.execPath, [builderCli, platform === 'win32' ? '--win' : '--linux']]);
  }
  commands.push([process.execPath, [path.join(ROOT, 'scripts', 'check-desktop-artifact.js'), '--platform', platform]]);
  return commands;
}

function main(args = process.argv.slice(2)) {
  const platform = selectPlatform(args);
  cleanDist();
  for (const [command, commandArgs] of commandsFor(platform)) run(command, commandArgs);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`[Paperweight] Desktop packaging failed: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { cleanDist, commandsFor, main, selectPlatform };
