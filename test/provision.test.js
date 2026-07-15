process.env.PAPERWEIGHT_ALLOW_MISSING_ENV = 'true';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildEnv, provisionEnv, slugify, cleanEnvValue } = require('../src/setup/provision');

// buildEnv doesn't touch disk, so any non-empty string satisfies the
// "seed file required when Private" check without needing a real file.
const FAKE_SEED = '/tmp/fake-seed.mp3';

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
  const built = buildEnv({ stationName: 'Test Station', vaultPath: './vault', seedFile: FAKE_SEED });
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
  const built = buildEnv({ stationName: 'Test Station', initialVisibility: 'nonsense', seedFile: FAKE_SEED });
  assert.match(built.contents, /^VAULT_DEFAULT_VISIBILITY=vault$/m);
  assert.equal(built.vaultDefaultVisibility, 'vault');
});

test('buildEnv requires a seed file when Private import visibility is chosen', () => {
  assert.throws(
    () => buildEnv({ stationName: 'Test Station', initialVisibility: 'vault' }),
    /public seed file is required/
  );
});

test('buildEnv does not require a seed file when Public import visibility is chosen', () => {
  assert.doesNotThrow(() => buildEnv({ stationName: 'Test Station', initialVisibility: 'public' }));
});

test('buildEnv sets TRUST_PROXY=loopback when a Cloudflare tunnel token is given', () => {
  const built = buildEnv({ stationName: 'Test', cfTunnelToken: 'abc123', seedFile: FAKE_SEED });
  assert.match(built.contents, /^TRUST_PROXY=loopback$/m);
});

test('buildEnv leaves STATION_PUBLIC_URL blank by default instead of the self-referential vanity URL', () => {
  const built = buildEnv({ stationName: 'Test Station', seedFile: FAKE_SEED });
  assert.match(built.contents, /^STATION_PUBLIC_URL=$/m);
  assert.equal(built.stationPublicUrl, '');
});

test('buildEnv writes an explicitly provided publicUrl as-is', () => {
  const built = buildEnv({ stationName: 'Test Station', publicUrl: 'https://my-tunnel.trycloudflare.com', seedFile: FAKE_SEED });
  assert.match(built.contents, /^STATION_PUBLIC_URL=https:\/\/my-tunnel\.trycloudflare\.com$/m);
});

test('provisionEnv writes .env and creates the expected directory tree', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-provision-'));
  const seedSrc = path.join(tmpDir, 'my-track.mp3');
  fs.writeFileSync(seedSrc, 'fake audio bytes');
  try {
    const result = provisionEnv({ stationName: 'Acme Radio', vaultPath: './vault', seedFile: seedSrc }, tmpDir);

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

test('provisionEnv copies the seed file into the vault and records VAULT_SEED_PUBLIC_FILE', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-provision-'));
  const seedSrc = path.join(tmpDir, 'starter-track.mp3');
  fs.writeFileSync(seedSrc, 'fake audio bytes');
  try {
    const result = provisionEnv({ stationName: 'Acme Radio', initialVisibility: 'vault', seedFile: seedSrc }, tmpDir);

    assert.ok(result.seedDestPath);
    assert.ok(fs.existsSync(result.seedDestPath), 'seed file was not copied into the vault');
    assert.equal(path.dirname(result.seedDestPath), result.vaultAbs);
    assert.equal(fs.readFileSync(result.seedDestPath, 'utf8'), 'fake audio bytes');

    const envContents = fs.readFileSync(path.join(tmpDir, '.env'), 'utf8');
    assert.match(envContents, new RegExp(`^VAULT_SEED_PUBLIC_FILE=${result.seedDestPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('provisionEnv dedupes a seed filename that already exists in the vault', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-provision-'));
  const seedSrc = path.join(tmpDir, 'track.mp3');
  fs.writeFileSync(seedSrc, 'seed bytes');
  try {
    fs.mkdirSync(path.join(tmpDir, 'vault'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'vault', 'track.mp3'), 'a pre-existing file');

    const result = provisionEnv({ stationName: 'Acme Radio', initialVisibility: 'vault', seedFile: seedSrc }, tmpDir);

    assert.equal(path.basename(result.seedDestPath), 'track-2.mp3');
    assert.equal(fs.readFileSync(path.join(tmpDir, 'vault', 'track.mp3'), 'utf8'), 'a pre-existing file');
    assert.equal(fs.readFileSync(result.seedDestPath, 'utf8'), 'seed bytes');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('provisionEnv throws when Private is chosen without a seed file', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-provision-'));
  try {
    assert.throws(
      () => provisionEnv({ stationName: 'Acme Radio', initialVisibility: 'vault' }, tmpDir),
      /public seed file is required/
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('provisionEnv does not require or copy a seed file when Public is chosen', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-provision-'));
  try {
    const result = provisionEnv({ stationName: 'Acme Radio', initialVisibility: 'public' }, tmpDir);
    assert.equal(result.seedDestPath, '');
    const envContents = fs.readFileSync(path.join(tmpDir, '.env'), 'utf8');
    assert.match(envContents, /^VAULT_SEED_PUBLIC_FILE=$/m);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
