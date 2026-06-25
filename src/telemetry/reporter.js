/**
 * Phone-home reporter: posts anonymized station telemetry to system.pape
 * every PAPE_REPORT_INTERVAL_MS (default 5 minutes).
 *
 * Required env vars to enable:
 *   PAPE_URL               — base URL of your Paperweight System instance
 *                            e.g. https://system.paperweighthq.com
 *   PAPE_TELEMETRY_SECRET  — shared secret matching PAPERWEIGHT_TELEMETRY_SECRET in system.pape
 *
 * Station identity:
 *   STATION_KEY            — explicit stable identifier for this station
 *   STATION_SLUG           — used as the station key when present
 *
 * If neither STATION_KEY nor STATION_SLUG is set, Paperweight creates a stable
 * anonymous install key in DATA_PATH so first-launch telemetry can still be
 * deduplicated in system.pape.
 *
 * If PAPE_URL or PAPE_TELEMETRY_SECRET are missing, reporting is silently disabled.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getDb } = require('../db');
const broadcast = require('../broadcast');
const { getListenerCount } = require('../api/stream');
const config = require('../config');

const PAPE_URL = process.env.PAPE_URL;
const PAPE_TELEMETRY_SECRET = process.env.PAPE_TELEMETRY_SECRET;
// STATION_SLUG is already globally unique (it's the *.paperweighthq.com subdomain),
// so use it as the key fallback when STATION_KEY isn't explicitly set.
const CONFIGURED_STATION_KEY = process.env.STATION_KEY || config.station?.slug || null;
const INSTALL_ID_FILE = path.join(config.paths.data, 'paperweight-install.json');
const INTERVAL_MS = Number(process.env.PAPE_REPORT_INTERVAL_MS ?? 5 * 60 * 1000);

let cachedInstallKey = null;

function readInstallKey() {
  try {
    const parsed = JSON.parse(fs.readFileSync(INSTALL_ID_FILE, 'utf8'));
    if (typeof parsed.installKey === 'string' && parsed.installKey.startsWith('pwinst_')) {
      return parsed.installKey;
    }
  } catch {}
  return null;
}

function createInstallKey() {
  const installKey = `pwinst_${crypto.randomBytes(16).toString('hex')}`;
  fs.mkdirSync(config.paths.data, { recursive: true });
  fs.writeFileSync(
    INSTALL_ID_FILE,
    JSON.stringify({ installKey, createdAt: new Date().toISOString() }, null, 2),
    { mode: 0o600 }
  );
  return installKey;
}

function getStationKey() {
  if (CONFIGURED_STATION_KEY) return CONFIGURED_STATION_KEY;
  if (!cachedInstallKey) cachedInstallKey = readInstallKey() || createInstallKey();
  return cachedInstallKey;
}

function isConfigured() {
  return !!(PAPE_URL && PAPE_TELEMETRY_SECRET);
}

async function buildPayload() {
  const db = getDb();

  const tokenStats = db.prepare(`
    SELECT
      COUNT(*) AS totalTokens,
      SUM(CASE WHEN tier = 'subscriber' THEN 1 ELSE 0 END) AS subscribers,
      SUM(CASE WHEN tier = 'pro' THEN 1 ELSE 0 END) AS pro,
      SUM(CASE WHEN tier = 'all_access' THEN 1 ELSE 0 END) AS allAccess
    FROM tokens
  `).get();

  const mediaStats = db.prepare(`
    SELECT
      COUNT(*) AS totalTracks,
      SUM(CASE WHEN visibility = 'vault' THEN 1 ELSE 0 END) AS vaultTracks
    FROM media
    WHERE status = 'ready'
  `).get();

  const todayListeners = db.prepare(`
    SELECT COUNT(DISTINCT ip_hash) AS uniqueToday
    FROM listen_events
    WHERE started_at >= date('now')
  `).get();

  const revenueStats = db.prepare(`
    SELECT COALESCE(SUM(amount_cents), 0) AS grossCents
    FROM tips
  `).get();

  const broadcastState = broadcast.getState();
  const broadcasting = !!(broadcastState && broadcastState.isLive);
  const currentTrack = broadcasting && broadcastState.nowPlaying
    ? (broadcastState.nowPlaying.title || null)
    : null;

  // Derive publicUrl: prefer explicit env var, then construct from slug + known domain.
  const publicUrl = config.station?.publicUrl
    || (config.station?.slug ? `https://${config.station.slug}.paperweighthq.com` : null);

  let version = null;
  try { version = require('../../package.json').version; } catch {}

  return {
    stationKey: getStationKey(),
    slug: config.station?.slug || null,
    publicUrl,
    version,
    platform: process.platform,
    listeners: getListenerCount(),
    uniqueListenersToday: todayListeners.uniqueToday || 0,
    totalTokens: tokenStats.totalTokens || 0,
    subscribers: tokenStats.subscribers || 0,
    pro: tokenStats.pro || 0,
    allAccess: tokenStats.allAccess || 0,
    totalTracks: mediaStats.totalTracks || 0,
    vaultTracks: mediaStats.vaultTracks || 0,
    broadcasting,
    currentTrack,
    grossCents: revenueStats.grossCents || 0,
  };
}

async function report() {
  try {
    const payload = await buildPayload();
    const res = await fetch(`${PAPE_URL}/api/modules/paperweight/ingest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-telemetry-secret': PAPE_TELEMETRY_SECRET,
      },
      body: JSON.stringify(payload),
    });

    if (res.status === 409) {
      const body = await res.json().catch(() => ({}));
      console.warn(`[telemetry] Slug conflict: ${body.error ?? 'slug already claimed by another station'}. Clear STATION_SLUG or set a unique STATION_KEY.`);
    } else if (!res.ok) {
      console.warn(`[telemetry] system.pape ingest failed: ${res.status}`);
    }
  } catch (err) {
    // Network errors are non-fatal — don't crash the station.
    console.warn(`[telemetry] report error: ${err.message}`);
  }
}

function start() {
  if (!isConfigured()) {
    if (PAPE_URL || PAPE_TELEMETRY_SECRET) {
      console.warn('[telemetry] PAPE_URL and PAPE_TELEMETRY_SECRET must both be set. Reporting disabled.');
    }
    return;
  }

  const stationKey = getStationKey();
  console.log(`[telemetry] Reporting to ${PAPE_URL} every ${INTERVAL_MS / 1000}s as station "${stationKey}"`);
  report(); // immediate first report
  setInterval(report, INTERVAL_MS);
}

module.exports = {
  start,
  _private: {
    getStationKey,
    readInstallKey,
    createInstallKey,
    INSTALL_ID_FILE,
  },
};
