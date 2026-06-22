process.env.PAPERWEIGHT_ALLOW_MISSING_ENV = 'true';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildEnv, provisionEnv, slugify, cleanEnvValue } = require('../src/setup/provision');

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
  assert.match(built.contents, /^TRUST_PROXY=false$/m);
  assert.match(built.contents, /^DASHBOARD_TOKEN=[0-9a-f]{64}$/m);
  assert.match(built.contents, /^DOWNLOAD_SIGNING_SECRET=[0-9a-f]{64}$/m);
  assert.equal(built.slug, 'test-station');
});

test('buildEnv sets TRUST_PROXY=loopback when a Cloudflare tunnel token is given', () => {
  const built = buildEnv({ stationName: 'Test', cfTunnelToken: 'abc123' });
  assert.match(built.contents, /^TRUST_PROXY=loopback$/m);
});

test('buildEnv leaves STATION_PUBLIC_URL blank by default instead of the self-referential vanity URL', () => {
  const built = buildEnv({ stationName: 'Test Station' });
  assert.match(built.contents, /^STATION_PUBLIC_URL=$/m);
  assert.equal(built.stationPublicUrl, '');
});

test('buildEnv writes an explicitly provided publicUrl as-is', () => {
  const built = buildEnv({ stationName: 'Test Station', publicUrl: 'https://my-tunnel.trycloudflare.com' });
  assert.match(built.contents, /^STATION_PUBLIC_URL=https:\/\/my-tunnel\.trycloudflare\.com$/m);
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
