process.env.PAPERWEIGHT_ALLOW_MISSING_ENV = 'true';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildEnv, provisionEnv, slugify, cleanEnvValue } = require('../src/setup/provision');

test('desktop IPC modules do not load config before first-run setup', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-electron-first-run-'));

  // electron/ipc/app-handlers.js and vault-handlers.js require the real
  // 'electron' package, which only ever exists under electron/node_modules
  // (a separate `cd electron && npm ci`) — the root project's own npm
  // install/ci never installs it, on purpose, so the root dependency tree
  // used by @yao-pkg/pkg builds (npm run build:exe, the Linux x64/Pi CI
  // jobs) stays free of it. This test only cares about import-graph
  // *ordering* (does requiring these files pull in src/config too early),
  // not real Electron behavior, so a minimal stub satisfies the three named
  // imports these files actually destructure (ipcMain, shell, dialog)
  // without needing the real package. NODE_PATH is only a fallback after
  // normal resolution, so a real electron/node_modules/electron still wins
  // if one happens to be present.
  const stubModulesDir = path.join(tmpDir, 'stub_node_modules');
  fs.mkdirSync(path.join(stubModulesDir, 'electron'), { recursive: true });
  fs.writeFileSync(
    path.join(stubModulesDir, 'electron', 'index.js'),
    'module.exports = { ipcMain: {}, shell: {}, dialog: {} };\n'
  );

  const script = `
    const configPath = require.resolve('./src/config');
    require('./electron/ipc/app-handlers');
    require('./electron/ipc/vault-handlers');
    if (require.cache[configPath]) {
      throw new Error('Desktop IPC imports loaded src/config before setup');
    }
  `;

  try {
    const result = spawnSync(process.execPath, ['-e', script], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8',
      env: {
        ...process.env,
        PAPERWEIGHT_ELECTRON: 'true',
        PAPERWEIGHT_DATA_ROOT: tmpDir,
        PAPERWEIGHT_ALLOW_MISSING_ENV: '',
        NODE_PATH: stubModulesDir,
      },
    });

    assert.equal(
      result.status,
      0,
      `desktop IPC import failed during first-run boot:\n${result.stderr || result.stdout}`
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('slugify mirrors scripts/setup.sh rules', () => {
  assert.equal(slugify('My Cool Station!!'), 'my-cool-station');
  assert.equal(slugify('  leading and trailing  '), 'leading-and-trailing');
  assert.equal(slugify(''), '');
});

test('cleanEnvValue rejects # and carriage returns', () => {
  assert.throws(() => cleanEnvValue('Station name', 'has # in it'), /cannot contain/);
  assert.throws(() => cleanEnvValue('Station name', 'has\rCR'), /cannot contain/);
  assert.equal(cleanEnvValue('Station name', '  trimmed  '), 'trimmed');
});

test('buildEnv requires a station name', () => {
  assert.throws(() => buildEnv({ stationName: '' }), /Station name is required/);
});

test('buildEnv writes expected .env keys and defaults', () => {
  const built = buildEnv({ stationName: 'Test Station', vaultPath: './vault' });
  assert.match(built.contents, /^STATION_NAME=Test Station$/m);
  assert.match(built.contents, /^STATION_IDENTITY=anonymous$/m);
  assert.match(built.contents, /^VAULT_MODE=hybrid$/m);
  assert.match(built.contents, /^VAULT_DEFAULT_VISIBILITY=vault$/m);
  assert.match(built.contents, /^TRUST_PROXY=false$/m);
  assert.match(built.contents, /^DASHBOARD_TOKEN=[0-9a-f]{64}$/m);
  assert.match(built.contents, /^DOWNLOAD_SIGNING_SECRET=[0-9a-f]{64}$/m);
  assert.equal(built.slug, 'test-station');
  assert.equal(built.vaultDefaultVisibility, 'vault');
});

test('buildEnv accepts an explicit public initial import visibility', () => {
  const built = buildEnv({ stationName: 'Test Station', initialVisibility: 'public' });
  assert.match(built.contents, /^VAULT_DEFAULT_VISIBILITY=public$/m);
  assert.equal(built.vaultDefaultVisibility, 'public');
});

test('buildEnv falls back to vault for an invalid initial import visibility', () => {
  const built = buildEnv({ stationName: 'Test Station', initialVisibility: 'nonsense' });
  assert.match(built.contents, /^VAULT_DEFAULT_VISIBILITY=vault$/m);
  assert.equal(built.vaultDefaultVisibility, 'vault');
});

test('buildEnv leaves STATION_PUBLIC_URL blank by default instead of the self-referential vanity URL', () => {
  const built = buildEnv({ stationName: 'Test Station' });
  assert.match(built.contents, /^STATION_PUBLIC_URL=$/m);
  assert.equal(built.stationPublicUrl, '');
});

test('buildEnv writes an explicitly provided publicUrl as-is', () => {
  const built = buildEnv({ stationName: 'Test Station', publicUrl: 'https://radio.example.com' });
  assert.match(built.contents, /^STATION_PUBLIC_URL=https:\/\/radio\.example\.com$/m);
  assert.match(built.contents, /^TRUST_PROXY=loopback$/m);
});

test('provisionEnv writes .env and creates the expected directory tree', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-provision-'));
  try {
    const result = provisionEnv({ stationName: 'Acme Radio', vaultPath: './vault' }, tmpDir);

    assert.ok(fs.existsSync(path.join(tmpDir, '.env')));
    assert.ok(fs.existsSync(path.join(tmpDir, 'data')));
    assert.ok(fs.existsSync(path.join(tmpDir, 'logs')));
    assert.ok(fs.existsSync(path.join(tmpDir, 'hls_output', 'stream')));
    assert.ok(fs.existsSync(path.join(tmpDir, 'hls_output', 'previews')));

    for (const sub of ['music', 'beats', 'podcasts', 'videos', 'drafts', 'live_sessions']) {
      assert.ok(fs.existsSync(path.join(result.vaultAbs, sub)), `missing vault/${sub}`);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('provisionEnv refuses to overwrite an existing .env', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-provision-'));
  try {
    fs.writeFileSync(path.join(tmpDir, '.env'), 'EXISTING=1\n');
    assert.throws(() => provisionEnv({ stationName: 'Acme Radio' }, tmpDir), /already exists/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
