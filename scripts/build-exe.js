#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { assertLinuxElfArch } = require('./lib/binary-target');
const { fetchFfmpeg } = require('./fetch-ffmpeg');
const { generateNativeBundle } = require('./generate-native-bundle');
const { generateFfmpegBundle } = require('./generate-ffmpeg-bundle');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const BUILD_WORK = path.join(DIST, '.build');
const NATIVE_BUNDLE = path.join(ROOT, 'src', 'native-bundle.js');
const FFMPEG_BUNDLE = path.join(ROOT, 'src', 'ffmpeg-bundle.js');

const TARGETS = Object.freeze([
  { key: 'linux-x64', aliases: ['linux'], platform: 'linux', arch: 'x64', label: 'Linux x64', target: 'node20-linux-x64', nodeVersion: '20.18.1', abi: '115', out: 'paperweight-linux-x64' },
  { key: 'linux-arm64', aliases: ['pi', 'raspberry-pi', 'raspi'], platform: 'linux', arch: 'arm64', label: 'Raspberry Pi / Linux ARM64', target: 'node20-linux-arm64', nodeVersion: '20.18.1', abi: '115', out: 'paperweight-linux-arm64' },
]);

function usage() {
  return `Usage:
  npm run build:exe
  npm run build:exe -- --target linux-arm64 --allow-cross
  npm run build:exe -- --all --allow-cross

Targets:
${TARGETS.map(target => `  ${target.key.padEnd(13)} ${target.label}`).join('\n')}`;
}

function findTarget(name) {
  const normalized = String(name || '').trim().toLowerCase();
  return TARGETS.find(target => target.key === normalized || target.target === normalized || target.aliases.includes(normalized));
}

function readTargetArgs(args) {
  const requested = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--target' || arg === '--targets') {
      if (!args[i + 1]) throw new Error(`Missing value for ${arg}`);
      requested.push(...args[i + 1].split(','));
      i += 1;
    } else if (arg.startsWith('--target=')) {
      requested.push(...arg.slice('--target='.length).split(','));
    } else if (arg.startsWith('--targets=')) {
      requested.push(...arg.slice('--targets='.length).split(','));
    }
  }
  return requested;
}

function selectTargets(args, host = { platform: process.platform, arch: process.arch }) {
  const names = args.includes('--all') ? TARGETS.map(target => target.key) : readTargetArgs(args);
  const selected = names.length
    ? names.map(name => {
      const target = findTarget(name);
      if (!target) throw new Error(`Unknown executable target: ${name}`);
      return target;
    })
    : TARGETS.filter(target => target.platform === host.platform && target.arch === host.arch);

  if (!selected.length) throw new Error(`No packaged target is configured for ${host.platform}/${host.arch}`);
  const crossTargets = selected.filter(target => target.platform !== host.platform || target.arch !== host.arch);
  if (crossTargets.length && !args.includes('--allow-cross')) {
    throw new Error(`Non-native target(s) require --allow-cross: ${crossTargets.map(target => target.key).join(', ')}`);
  }
  if (crossTargets.length && host.platform !== 'linux') {
    throw new Error('Executable cross-building is supported only on Linux hosts between x64 and ARM64');
  }
  return selected;
}

function run(command, args, options = {}) {
  console.log(`  $ ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit', windowsHide: true, ...options });
  if (result.status !== 0) throw new Error(`${command} failed (exit ${result.status ?? 'unknown'})`);
}

function tryRun(command, args, options = {}) {
  console.log(`  $ ${command} ${args.join(' ')}`);
  return spawnSync(command, args, { cwd: ROOT, stdio: 'inherit', windowsHide: true, ...options }).status === 0;
}

function resetDir(dir, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(dir));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing to reset unsafe build directory: ${dir}`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

function prebuildArgsFor(target, prebuildCli = require.resolve('prebuild-install/bin.js', { paths: [ROOT] })) {
  return [prebuildCli, '--target', target.nodeVersion, '--runtime', 'node', '--platform', target.platform, '--arch', target.arch, '--force'];
}

function acquireNativeBinding(target, workDir, host = { platform: process.platform, arch: process.arch }) {
  const sourceModule = path.join(ROOT, 'node_modules', 'better-sqlite3');
  const moduleDir = path.join(workDir, 'better-sqlite3');
  if (!fs.existsSync(sourceModule)) throw new Error('better-sqlite3 is not installed; run npm install first');
  fs.cpSync(sourceModule, moduleDir, { recursive: true });
  fs.rmSync(path.join(moduleDir, 'build'), { recursive: true, force: true });

  const prebuildCli = require.resolve('prebuild-install/bin.js', { paths: [ROOT] });
  const prebuildArgs = prebuildArgsFor(target, prebuildCli);
  // prebuild-install loads package.json before processing --path, so cwd must
  // be the isolated module tree or it would resolve Paperweight's metadata.
  let acquired = tryRun(process.execPath, prebuildArgs, { cwd: moduleDir });

  const isNativeTarget = target.platform === host.platform && target.arch === host.arch;
  if (!acquired && isNativeTarget) {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    acquired = tryRun(npm, ['run', 'build-release', '--', `--target=${target.nodeVersion}`, '--dist-url=https://nodejs.org/dist'], { cwd: moduleDir });
  }
  if (!acquired) {
    const detail = isNativeTarget ? 'prebuilt download and isolated source build both failed' : 'no compatible upstream prebuilt binary was available';
    throw new Error(`Could not acquire better-sqlite3 for ${target.key}: ${detail}`);
  }

  const binding = path.join(moduleDir, 'build', 'Release', 'better_sqlite3.node');
  if (!fs.existsSync(binding)) throw new Error(`better-sqlite3 acquisition did not produce ${binding}`);
  assertLinuxElfArch(binding, target.arch, 'better_sqlite3.node');
  return binding;
}

async function prepareTargetBundles(target, workDir) {
  const nativeBinding = acquireNativeBinding(target, workDir);
  const ffmpegDir = path.join(ROOT, 'vendor', 'ffmpeg', target.key);
  const ffmpeg = await fetchFfmpeg({ platform: target.platform, arch: target.arch, dest: ffmpegDir });
  assertLinuxElfArch(ffmpeg.ffmpeg, target.arch, 'ffmpeg');
  assertLinuxElfArch(ffmpeg.ffprobe, target.arch, 'ffprobe');

  generateNativeBundle({ input: nativeBinding, output: NATIVE_BUNDLE, platform: target.platform, arch: target.arch, abi: target.abi });
  generateFfmpegBundle({ inputDir: ffmpegDir, output: FFMPEG_BUNDLE, platform: target.platform, arch: target.arch });
}

async function main(args = process.argv.slice(2)) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(usage());
    return;
  }
  const targets = selectTargets(args);
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const pkgCli = require.resolve('@yao-pkg/pkg/lib-es5/bin.js', { paths: [ROOT] });

  console.log(`Paperweight executable targets: ${targets.map(target => target.key).join(', ')}`);
  run(process.execPath, [path.join(ROOT, 'scripts', 'generate-client-bundle.js')]);
  run(npm, ['run', 'release:check']);
  fs.mkdirSync(BUILD_WORK, { recursive: true });

  try {
    for (const target of targets) {
      const workDir = path.join(BUILD_WORK, target.key);
      resetDir(workDir, BUILD_WORK);
      try {
        await prepareTargetBundles(target, workDir);
        run(process.execPath, [path.join(ROOT, 'scripts', 'check-package-assets.js'), '--require-binary-bundles', '--platform', target.platform, '--arch', target.arch, '--abi', target.abi]);
        const output = path.join(DIST, target.out);
        run(process.execPath, [pkgCli, path.join(ROOT, 'src', 'launcher.js'), '--target', target.target, '--output', output, '--compress', 'GZip']);
        console.log(`OK   ${target.label}: ${output}`);
      } finally {
        fs.rmSync(workDir, { recursive: true, force: true });
      }
    }
  } finally {
    try { fs.rmdirSync(BUILD_WORK); } catch {}
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error(`Build failed: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { TARGETS, acquireNativeBinding, findTarget, main, prebuildArgsFor, prepareTargetBundles, readTargetArgs, selectTargets, usage };
