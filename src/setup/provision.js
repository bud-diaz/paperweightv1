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
  initialVisibility = 'vault',
  seedFile = '',
  cfTunnelToken = '',
  publicUrl = '',
}) {
  const cleanStationName = cleanEnvValue('Station name', stationName);
  if (!cleanStationName) throw new Error('Station name is required.');

  const slugAuto = slugify(cleanStationName) || 'paperweight';
  const cleanSlug = cleanEnvValue('Station slug', slug || slugAuto) || slugAuto;
  // STATION_PUBLIC_URL must be the station's actual reachable address (tunnel,
  // reverse proxy, or public IP) — never the <slug>.paperweighthq.com vanity
  // URL itself. system.pape's redirect for that vanity URL targets whatever
  // is stored here, so setting it to itself creates a redirect loop and the
  // anti-loop guard silently bounces visitors to the apex site instead.
  const stationPublicUrl = cleanEnvValue('Station public URL', publicUrl);

  const stationIdentity = identityMode === 'creator' ? 'creator' : 'anonymous';
  const cleanCreatorName = stationIdentity === 'creator' ? cleanEnvValue('Creator name', creatorName) : '';
  const cleanCreatorDesc = stationIdentity === 'creator' ? cleanEnvValue('Station description', creatorDesc) : '';

  const cleanVaultPath = cleanEnvValue('Vault path', vaultPath || './vault') || './vault';
  const cleanVaultMode = ['hybrid', 'folder', 'metadata'].includes(vaultMode) ? vaultMode : 'hybrid';
  const cleanInitialVisibility = initialVisibility === 'public' ? 'public' : 'vault';
  const cleanSeedFile = cleanInitialVisibility === 'vault' ? cleanEnvValue('Seed file path', seedFile) : '';
  if (cleanInitialVisibility === 'vault' && !cleanSeedFile) {
    throw new Error('A public seed file is required when Private import visibility is chosen, so the broadcast has something to play at launch.');
  }

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
    `VAULT_DEFAULT_VISIBILITY=${cleanInitialVisibility}`,
    'VAULT_SEED_PUBLIC_FILE=',
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
    '# Optional outbound email (password resets, supporter post notifications)',
    'SMTP_HOST=',
    'SMTP_PORT=',
    'SMTP_SECURE=',
    'SMTP_USER=',
    'SMTP_PASS=',
    'SMTP_FROM=',
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
    vaultDefaultVisibility: cleanInitialVisibility,
    seedFile: cleanSeedFile,
  };
}

// Appends "-2", "-3", etc. before the extension if `basename` already exists
// in `vaultAbs`, so copying a seed file never silently overwrites an existing one.
function dedupeVaultFilename(vaultAbs, basename) {
  const ext = path.extname(basename);
  const stem = path.basename(basename, ext);
  let candidate = basename;
  let n = 2;
  while (fs.existsSync(path.join(vaultAbs, candidate))) {
    candidate = `${stem}-${n}${ext}`;
    n++;
  }
  return candidate;
}

// Writes .env and creates the runtime directory tree under `dataRoot`.
// Throws if .env already exists (same guard as scripts/setup.sh).
function provisionEnv(fields, dataRoot) {
  const envPath = path.join(dataRoot, '.env');
  if (fs.existsSync(envPath)) {
    throw new Error('.env already exists. Delete it first to re-run setup.');
  }

  const built = buildEnv(fields);

  for (const dir of ['data', 'logs', path.join('hls_output', 'stream'), path.join('hls_output', 'previews')]) {
    fs.mkdirSync(path.join(dataRoot, dir), { recursive: true });
  }

  const vaultAbs = path.resolve(dataRoot, built.vaultPath);
  for (const sub of VAULT_SUBDIRS) {
    fs.mkdirSync(path.join(vaultAbs, sub), { recursive: true });
  }

  let contents = built.contents;
  let seedDestPath = '';
  if (built.seedFile) {
    if (!fs.existsSync(built.seedFile)) {
      throw new Error(`Seed file not found: ${built.seedFile}`);
    }
    const destBasename = dedupeVaultFilename(vaultAbs, path.basename(built.seedFile));
    seedDestPath = path.join(vaultAbs, destBasename);
    fs.copyFileSync(built.seedFile, seedDestPath);
    contents = contents.replace(/^VAULT_SEED_PUBLIC_FILE=$/m, `VAULT_SEED_PUBLIC_FILE=${seedDestPath}`);
  }

  fs.writeFileSync(envPath, contents, 'utf8');

  return { ...built, envPath, vaultAbs, seedDestPath };
}

module.exports = { cleanEnvValue, slugify, buildEnv, provisionEnv, VAULT_SUBDIRS };
