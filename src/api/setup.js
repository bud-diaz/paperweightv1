const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const config = require('../config');

let submitted = false;

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// Plain text values land directly in .env lines, so reject anything that
// could start a comment or a new line.
function cleanField(label, value) {
  const v = String(value ?? '').trim();
  if (/[#\r\n]/.test(v)) {
    throw new Error(`${label} cannot contain '#' or line breaks.`);
  }
  return v;
}

router.get('/', (req, res) => {
  res.json({ firstRun: config.firstRun, submitted });
});

router.post('/', (req, res) => {
  if (!config.firstRun || submitted) {
    return res.status(410).json({ error: 'Setup has already been completed for this station.' });
  }

  let body;
  try {
    body = req.body || {};
    const stationName = cleanField('Station name', body.stationName);
    if (!stationName) throw new Error('Station name is required.');

    const identity = body.identity === 'creator' ? 'creator' : 'anonymous';
    const creatorName = identity === 'creator' ? cleanField('Your name', body.creatorName) : '';
    const creatorDesc = identity === 'creator' ? cleanField('Station description', body.creatorDesc) : '';

    const vaultPath = cleanField('Vault path', body.vaultPath) || './vault';
    const vaultMode = ['hybrid', 'folder', 'metadata'].includes(body.vaultMode) ? body.vaultMode : 'hybrid';

    const cfTunnelToken = cleanField('Cloudflare tunnel token', body.cloudflareTunnelToken);

    const slug = slugify(body.stationSlug) || slugify(stationName) || 'paperweight';
    const publicUrl = `https://${slug}.paperweighthq.com`;

    body = {
      stationName, identity, creatorName, creatorDesc,
      vaultPath, vaultMode, cfTunnelToken, slug, publicUrl,
    };
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  config.upsertEnvValues({
    STATION_NAME: body.stationName,
    STATION_IDENTITY: body.identity,
    CREATOR_NAME: body.creatorName,
    CREATOR_DESC: body.creatorDesc,
    VAULT_PATH: body.vaultPath,
    VAULT_MODE: body.vaultMode,
    STATION_SLUG: body.slug,
    STATION_PUBLIC_URL: body.publicUrl,
    CLOUDFLARE_TUNNEL_TOKEN: body.cfTunnelToken,
    TRUST_PROXY: body.cfTunnelToken ? 'loopback' : 'false',
  });

  const vaultAbs = path.resolve(config.paths.root, body.vaultPath);
  for (const sub of ['music', 'beats', 'podcasts', 'videos', 'drafts', 'live_sessions']) {
    fs.mkdirSync(path.join(vaultAbs, sub), { recursive: true });
  }

  submitted = true;
  res.json({ ok: true, restarting: true });

  // Give the response time to flush before the process restarts.
  setTimeout(() => {
    require('../index').restartForSetup();
  }, 300);
});

module.exports = router;
