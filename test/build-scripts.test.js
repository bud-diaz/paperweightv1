'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { ELF_MACHINE, assertLinuxElfArch, parseOptions } = require('../scripts/lib/binary-target');
const { TARGETS, prebuildArgsFor, readTargetArgs, selectTargets } = require('../scripts/build-exe');
const { generateNativeBundle } = require('../scripts/generate-native-bundle');
const { generateFfmpegBundle } = require('../scripts/generate-ffmpeg-bundle');
const { cleanDist, commandsFor, selectPlatform } = require('../electron/scripts/dist');
const { PRODUCT_NAME, configureAppIdentity } = require('../electron/product');
const { matchesPlatformDir, resourceDirsFromDist, resourceIssues } = require('../scripts/check-desktop-artifact');

function elfBuffer(arch) {
  const buffer = Buffer.alloc(64);
  buffer.set([0x7f, 0x45, 0x4c, 0x46]);
  buffer[4] = 2;
  buffer[5] = 1;
  buffer.writeUInt16LE(ELF_MACHINE[arch], 18);
  return buffer;
}

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-build-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('build target arguments support explicit and comma-separated targets', () => {
  assert.deepEqual(readTargetArgs(['--target', 'linux-x64,linux-arm64']), ['linux-x64', 'linux-arm64']);
  assert.deepEqual(readTargetArgs(['--targets=linux-arm64']), ['linux-arm64']);
  assert.deepEqual(parseOptions(['--platform', 'linux', '--arch=arm64', '--force']), { platform: 'linux', arch: 'arm64', force: true });
});

test('cross-target selection requires acknowledgement and a Linux host', () => {
  assert.throws(() => selectTargets(['--target', 'linux-arm64'], { platform: 'linux', arch: 'x64' }), /--allow-cross/);
  assert.deepEqual(selectTargets(['--target', 'linux-arm64', '--allow-cross'], { platform: 'linux', arch: 'x64' }).map(target => target.key), ['linux-arm64']);
  assert.throws(() => selectTargets(['--target', 'linux-arm64', '--allow-cross'], { platform: 'win32', arch: 'x64' }), /only on Linux/);
});

test('prebuild acquisition arguments pin target platform, architecture, runtime and Node version', () => {
  const target = TARGETS.find(candidate => candidate.arch === 'arm64');
  const args = prebuildArgsFor(target, '/tools/prebuild-install.js');
  assert.deepEqual(args, [
    '/tools/prebuild-install.js', '--target', '20.18.1', '--runtime', 'node',
    '--platform', 'linux', '--arch', 'arm64', '--force',
  ]);
});

test('ELF architecture validation rejects x64 and ARM64 mismatches', t => {
  const dir = tempDir(t);
  const x64 = path.join(dir, 'x64.node');
  const arm64 = path.join(dir, 'arm64.node');
  fs.writeFileSync(x64, elfBuffer('x64'));
  fs.writeFileSync(arm64, elfBuffer('arm64'));
  assert.doesNotThrow(() => assertLinuxElfArch(x64, 'x64'));
  assert.doesNotThrow(() => assertLinuxElfArch(arm64, 'arm64'));
  assert.throws(() => assertLinuxElfArch(x64, 'arm64'), /architecture mismatch/);
  assert.throws(() => assertLinuxElfArch(arm64, 'x64'), /architecture mismatch/);
});

test('bundle generators preserve explicit target metadata and inputs', t => {
  const dir = tempDir(t);
  const nativeInput = path.join(dir, 'better_sqlite3.node');
  const ffmpegDir = path.join(dir, 'ffmpeg');
  const nativeOutput = path.join(dir, 'native-bundle.js');
  const ffmpegOutput = path.join(dir, 'ffmpeg-bundle.js');
  fs.mkdirSync(ffmpegDir);
  fs.writeFileSync(nativeInput, elfBuffer('arm64'));
  fs.writeFileSync(path.join(ffmpegDir, 'ffmpeg'), elfBuffer('arm64'));
  fs.writeFileSync(path.join(ffmpegDir, 'ffprobe'), elfBuffer('arm64'));

  generateNativeBundle({ input: nativeInput, output: nativeOutput, platform: 'linux', arch: 'arm64', abi: '115' });
  generateFfmpegBundle({ inputDir: ffmpegDir, output: ffmpegOutput, platform: 'linux', arch: 'arm64' });
  const native = require(nativeOutput);
  const ffmpeg = require(ffmpegOutput);
  assert.equal(native.platform, 'linux');
  assert.equal(native.arch, 'arm64');
  assert.equal(native.abi, '115');
  assert.deepEqual(native.data, elfBuffer('arm64'));
  assert.equal(ffmpeg.platform, 'linux');
  assert.equal(ffmpeg.arch, 'arm64');
});

test('Electron dist dispatch is host-aware and maps every supported host', () => {
  assert.equal(selectPlatform([], 'win32'), 'win32');
  assert.equal(selectPlatform([], 'darwin'), 'darwin');
  assert.equal(selectPlatform([], 'linux'), 'linux');
  assert.throws(() => selectPlatform(['--target', 'darwin'], 'win32'), /Cannot build/);
  assert.deepEqual(commandsFor('win32').at(-1)[1].slice(-2), ['--platform', 'win32']);
  assert.deepEqual(commandsFor('linux').at(-1)[1].slice(-2), ['--platform', 'linux']);
  assert.deepEqual(commandsFor('darwin').at(-1)[1].slice(-2), ['--platform', 'darwin']);
});

test('Electron runtime identity matches package and builder product names', () => {
  const electronPackage = require('../electron/package.json');
  const universalConfig = require('../electron/electron-builder.universal.json');
  const calls = [];
  const app = {
    setName: value => calls.push(['name', value]),
    setAppUserModelId: value => calls.push(['appId', value]),
  };

  configureAppIdentity(app, 'win32');

  assert.equal(PRODUCT_NAME, 'Paperweight');
  assert.equal(electronPackage.productName, electronPackage.build.productName);
  assert.equal(electronPackage.productName, universalConfig.productName);
  assert.deepEqual(calls, [
    ['name', PRODUCT_NAME],
    ['appId', 'com.paperweight.desktop'],
  ]);
});

test('macOS universal merge permits staged Mach-O resources shared by both arches', () => {
  const universalConfig = require('../electron/electron-builder.universal.json');
  assert.equal(
    universalConfig.mac.x64ArchFiles,
    '**/{*.node,bin/cloudflared,bin/ffmpeg,bin/ffprobe}'
  );
});

test('desktop dist cleanup is confined to the exact output directory', t => {
  const dir = tempDir(t);
  const electronDir = path.join(dir, 'electron');
  const dist = path.join(electronDir, 'dist');
  const preserved = path.join(electronDir, 'preserved.txt');
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(path.join(dist, 'old-artifact'), 'old');
  fs.writeFileSync(preserved, 'keep');
  cleanDist(dist, electronDir);
  assert.equal(fs.existsSync(dist), false);
  assert.equal(fs.readFileSync(preserved, 'utf8'), 'keep');
  assert.throws(() => cleanDist(electronDir, electronDir), /unsafe path/);
});

test('artifact discovery ignores stale output for other platforms', t => {
  const dir = tempDir(t);
  const electronDir = path.join(dir, 'electron');
  const winResources = path.join(electronDir, 'dist', 'win-unpacked', 'resources');
  const linuxResources = path.join(electronDir, 'dist', 'linux-unpacked', 'resources');
  fs.mkdirSync(winResources, { recursive: true });
  fs.mkdirSync(linuxResources, { recursive: true });
  assert.deepEqual(resourceDirsFromDist('linux', electronDir), [linuxResources]);
  assert.deepEqual(resourceDirsFromDist('darwin', electronDir), []);
  assert.equal(matchesPlatformDir('win-unpacked', 'linux'), false);
});

test('artifact resource validation catches missing bundles, forbidden modules, and source maps', t => {
  const dir = tempDir(t);
  const resources = path.join(dir, 'resources');
  fs.mkdirSync(path.join(resources, 'src'), { recursive: true });
  assert.ok(resourceIssues(resources).some(issue => issue.includes('missing src/client-bundle.js')));

  fs.writeFileSync(path.join(resources, 'src', 'client-bundle.js'), 'module.exports = {};\n//# sourceMappingURL=x.map\n');
  fs.mkdirSync(path.join(resources, 'node_modules', 'terser'), { recursive: true });
  const issues = resourceIssues(resources);
  assert.ok(issues.some(issue => issue.includes('terser')));
  assert.ok(issues.some(issue => issue.includes('source map reference')));
});
