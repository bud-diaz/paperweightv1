/**
 * Phone-home reporter: posts anonymized station telemetry to system.pape
 * every PAPE_REPORT_INTERVAL_MS (default 5 minutes).
 *
 * Required env vars to enable:
 *   PAPE_URL               — base URL of your Paperweight System instance
 *                            e.g. https://system.paperweighthq.com
 *   PAPE_TELEMETRY_SECRET  — shared secret matching PAPERWEIGHT_TELEMETRY_SECRET in system.pape
 *
 * Station identity (at least one required):
 *   STATION_KEY            — explicit stable identifier for this station
 *                            defaults to STATION_SLUG if set, which is already globally unique
 *
 * If PAPE_URL or PAPE_TELEMETRY_SECRET are missing, reporting is silently disabled.
 */

'use strict';

const { getDb } = require('../db');
const broadcast = require('../broadcast');
const { getListenerCount } = require('../api/stream');
const config = require('../config');

const PAPE_URL = process.env.PAPE_URL;
const PAPE_TELEMETRY_SECRET = process.env.PAPE_TELEMETRY_SECRET;
// STATION_SLUG is already globally unique (it's the *.paperweighthq.com subdomain),
// so use it as the key fallback when STATION_KEY isn't explicitly set.
const STATION_KEY = process.env.STATION_KEY || config.station?.slug || null;
const INTERVAL_MS = Number(process.env.PAPE_REPORT_INTERVAL_MS ?? 5 * 60 * 1000);

function isConfigured() {
  return !!(PAPE_URL && PAPE_TELEMETRY_SECRET && STATION_KEY);
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
    stationKey: STATION_KEY,
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
      console.warn('[telemetry] PAPE_URL and PAPE_TELEMETRY_SECRET must both be set, and this station must have a STATION_KEY or STATION_SLUG. Reporting disabled.');
    }
    return;
  }

  console.log(`[telemetry] Reporting to ${PAPE_URL} every ${INTERVAL_MS / 1000}s as station "${STATION_KEY}"`);
  report(); // immediate first report
  setInterval(report, INTERVAL_MS);
}

module.exports = { start };
