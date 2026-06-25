const router = require('express').Router();
const crypto = require('crypto');
const { getDb } = require('../db');
const { authLimiter } = require('../middleware/rateLimiter');

const VALID_PLATFORMS = new Set(['win', 'mac-arm64', 'mac-x64', 'linux-x64', 'linux-arm64']);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254;
const MAX_PLATFORM_LENGTH = 32;
const MAX_FIELD_LENGTH = 128;
const MAX_REFERRER_LENGTH = 512;
const MAX_USER_AGENT_LENGTH = 512;

function normalizeEmail(email) {
  const value = typeof email === 'string' ? email.trim().toLowerCase() : '';
  return EMAIL_RE.test(value) && value.length <= MAX_EMAIL_LENGTH ? value : null;
}

function normalizePlatform(platform) {
  if (typeof platform !== 'string' || platform.length > MAX_PLATFORM_LENGTH) return null;
  const key = platform.trim().toLowerCase();
  return VALID_PLATFORMS.has(key) ? key : null;
}

function cleanString(value, max = MAX_FIELD_LENGTH) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function getIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || '';
}

function hashIp(ip) {
  const salt = process.env.DOWNLOAD_ANALYTICS_SALT || process.env.DOWNLOAD_SIGNING_SECRET || 'paperweight-download-analytics';
  return crypto.createHash('sha256').update(`${salt}:${ip}`).digest('hex');
}

function buildEvent(req) {
  const body = req.body || {};
  const referrer = cleanString(body.referrer, MAX_REFERRER_LENGTH) || cleanString(req.get('referer'), MAX_REFERRER_LENGTH);
  const userAgent = cleanString(req.get('user-agent'), MAX_USER_AGENT_LENGTH);

  return {
    email: normalizeEmail(body.email),
    platform: normalizePlatform(body.platform),
    artifact: cleanString(body.artifact),
    version: cleanString(body.version),
    source: cleanString(body.source || body.utmSource),
    medium: cleanString(body.medium || body.utmMedium),
    campaign: cleanString(body.campaign || body.utmCampaign),
    referrer,
    ipHash: hashIp(getIp(req)),
    userAgent,
  };
}

router.post('/', authLimiter, (req, res) => {
  const event = buildEvent(req);

  if (!event.platform) {
    return res.status(400).json({ error: 'Valid platform is required' });
  }

  getDb().prepare(`
    INSERT INTO download_events (
      email,
      platform,
      artifact,
      version,
      source,
      medium,
      campaign,
      referrer,
      ip_hash,
      user_agent
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    event.email,
    event.platform,
    event.artifact,
    event.version,
    event.source,
    event.medium,
    event.campaign,
    event.referrer,
    event.ipHash,
    event.userAgent
  );

  res.json({ ok: true });
});

module.exports = router;
module.exports._private = {
  normalizeEmail,
  normalizePlatform,
  cleanString,
  hashIp,
};
