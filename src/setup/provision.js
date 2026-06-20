const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Shared first-run provisioning logic for the creator-facing setup flow.
// `scripts/setup.sh` (Linux terminal setup) is intentionally NOT rewritten to
// call this — it stays a standalone bash script. This module is the single
// source of truth for the Electron setup wizard (Windows/Mac), so the two
// flows do not duplicate slug/validation rules and drift apart.

function cleanEnvValue(label, value) {
  const str = String(value || '');
  if (str.includes('#') || str.includes('\r')) {
    throw new Error(`${label} cannot contain # or carriage returns.`);
  }
  return str.trim();
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

const VAULT_SUBDIRS = ['music', 'beats', 'podcasts', 'videos', 'drafts', 'live_sessions'];

// Builds the .env file contents and the list of directories to create, given
// the fields collected by a setup wizard (Electron) or any future caller.
// Mirrors scripts/setup.sh's field set and defaults exactly.
function buildEnv({
  stationName,
  slug,
  identityMode = 'anonymous',
  creatorName = '',
  creatorDesc = '',
  vaultPath = './vault',
  vaultMode = 'hybrid',
  cfTunnelToken = '',
}) {
  const cleanStationName = cleanEnvValue('Station name', stationName);
  if (!cleanStationName) throw new Error('Station name is required.');

  const slugAuto = slugify(cleanStationName) || 'paperweight';
  const cleanSlug = cleanEnvValue('Station slug', slug || slugAuto) || slugAuto;
  const stationPublicUrl = `https://${cleanSlug}.paperweighthq.com`;

  const stationIdentity = identityMode === 'creator' ? 'creator' : 'anonymous';
  const cleanCreatorName = stationIdentity === 'creator' ? cleanEnvValue('Creator name', creatorName) : '';
  const cleanCreatorDesc = stationIdentity === 'creator' ? cleanEnvValue('Station description', creatorDesc) : '';

  const cleanVaultPath = cleanEnvValue('Vault path', vaultPath || './vault') || './vault';
  const cleanVaultMode = ['hybrid', 'folder', 'metadata'].includes(vaultMode) ? vaultMode : 'hybrid';

  const cleanCfToken = cleanEnvValue('Tunnel token', cfTunnelToken);
  const trustProxyValue = cleanCfToken ? 'loopback' : 'false';

  const dashboardToken = crypto.randomBytes(32).toString('hex');
  const downloadSigningSecret = crypto.randomBytes(32).toString('hex');

  const contents = [
    '# Paperweight configuration',
    `STATION_NAME=${cleanStationName}`,
    `STATION_IDENTITY=${stationIdentity}`,
    `CREATOR_NAME=${cleanCreatorName}`,
    `CREATOR_DESC=${cleanCreatorDesc}`,
    '',
    'HOST=127.0.0.1',
    'PORT=3000',
    `TRUST_PROXY=${trustProxyValue}`,
    '',
    `VAULT_PATH=${cleanVaultPath}`,
    `VAULT_MODE=${cleanVaultMode}`,
    '',
    `DASHBOARD_TOKEN=${dashboardToken}`,
    `DOWNLOAD_SIGNING_SECRET=${downloadSigningSecret}`,
    'HTTPS=false',
    '',
    `STATION_SLUG=${cleanSlug}`,
    `STATION_PUBLIC_URL=${stationPublicUrl}`,
    `CLOUDFLARE_TUNNEL_TOKEN=${cleanCfToken}`,
    '',
    'STRIPE_SECRET_KEY=',
    'STRIPE_WEBHOOK_SECRET=',
    'STRIPE_PRICE_SUBSCRIBER=',
    'STRIPE_PRICE_PRO=',
    'STRIPE_PRICE_ALL_ACCESS=',
    '',
    'PAYPAL_CLIENT_ID=',
    'PAYPAL_CLIENT_SECRET=',
    'PAYPAL_PLAN_PRO=',
    'PAYPAL_PLAN_ALL_ACCESS=',
    'PAYPAL_WEBHOOK_ID=',
    '',
    'DOWNLOAD_TOKEN_TTL_HOURS=48',
    '',
    'DATA_PATH=./data',
    'HLS_OUTPUT_PATH=./hls_output',
    'LOG_PATH=./logs',
    '',
  ].join('\n');

  return {
    contents,
    dashboardToken,
    downloadSigningSecret,
    stationName: cleanStationName,
    stationIdentity,
    slug: cleanSlug,
    stationPublicUrl,
    vaultPath: cleanVaultPath,
    vaultMode: cleanVaultMode,
  };
}

// Writes .env and creates the runtime directory tree under `dataRoot`.
// Throws if .env already exists (same guard as scripts/setup.sh).
function provisionEnv(fields, dataRoot) {
  const envPath = path.join(dataRoot, '.env');
  if (fs.existsSync(envPath)) {
    throw new Error('.env already exists. Delete it first to re-run setup.');
  }

  const built = buildEnv(fields);
  fs.writeFileSync(envPath, built.contents, 'utf8');

  for (const dir of ['data', 'logs', path.join('hls_output', 'stream'), path.join('hls_output', 'previews')]) {
    fs.mkdirSync(path.join(dataRoot, dir), { recursive: true });
  }

  const vaultAbs = path.resolve(dataRoot, built.vaultPath);
  for (const sub of VAULT_SUBDIRS) {
    fs.mkdirSync(path.join(vaultAbs, sub), { recursive: true });
  }

  return { ...built, envPath, vaultAbs };
}

module.exports = { cleanEnvValue, slugify, buildEnv, provisionEnv, VAULT_SUBDIRS };
