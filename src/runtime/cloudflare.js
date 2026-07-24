// Thin Cloudflare REST API client — pure Node `https`/`http`, no new
// dependencies, mirroring src/email/'s "degrade gracefully, never throw
// across the module boundary" approach.
//
// Used only by the dashboard's optional "auto-create tunnel" flow
// (CLOUDFLARE_API_TOKEN). This is a distinct credential from
// CLOUDFLARE_TUNNEL_TOKEN (the tunnel connector token cloudflared itself
// uses) — this API token is only ever used here, to call Cloudflare's control
// plane on the owner's behalf.
//
// Every function takes its token/ids as explicit arguments rather than
// reading process.env, and every function resolves to { ok, ...data, error? }
// instead of throwing, so callers never need a try/catch around a Cloudflare
// outage or a bad token.

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { URL: NodeURL } = require('url');

const DEFAULT_BASE_URL = 'https://api.cloudflare.com/client/v4';
const REQUEST_TIMEOUT_MS = 8000;

function isCloudflareApiConfigured(token) {
  return !!(token && String(token).trim());
}

// Cloudflare's own hostname is fixed/first-party, unlike the owner-supplied
// station URL or notify webhook — no SSRF guard needed here (contrast
// src/runtime/net-guard.js, which exists specifically for owner-configured
// hosts).
function request(baseUrl, method, path, token, body) {
  return new Promise(resolve => {
    let target;
    try {
      // path always starts with '/'; resolving a leading-slash reference
      // against a base URL replaces the base's own path (e.g. `/client/v4`)
      // instead of appending to it, per the WHATWG URL spec. Strip it so the
      // request lands under the base's path prefix.
      target = new NodeURL(path.replace(/^\/+/, ''), baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
    } catch {
      return resolve({ ok: false, error: 'Invalid Cloudflare API URL' });
    }

    const payload = body !== undefined ? JSON.stringify(body) : null;
    const lib = target.protocol === 'http:' ? http : https;
    const req = lib.request(target, {
      method,
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, res => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch {
          return resolve({ ok: false, error: `Invalid response from Cloudflare (HTTP ${res.statusCode})` });
        }
        if (parsed.success) {
          return resolve({ ok: true, result: parsed.result });
        }
        const message = (parsed.errors && parsed.errors[0] && parsed.errors[0].message)
          || `Cloudflare API error (HTTP ${res.statusCode})`;
        resolve({ ok: false, error: message });
      });
    });

    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'Cloudflare API request timed out' }); });
    req.on('error', err => resolve({ ok: false, error: `Cloudflare API request failed: ${err.message}` }));

    if (payload) req.write(payload);
    req.end();
  });
}

// baseUrl defaults to CLOUDFLARE_API_BASE_URL when set, purely so tests can
// point every call at a local stub server without threading a baseUrl
// through every dashboard.js call site — production never sets this env var,
// so it always resolves to the real Cloudflare API.
function resolvedBaseUrl(baseUrl) {
  return baseUrl || process.env.CLOUDFLARE_API_BASE_URL || DEFAULT_BASE_URL;
}

async function verifyToken(token, baseUrl) {
  return request(resolvedBaseUrl(baseUrl), 'GET', '/user/tokens/verify', token);
}

async function listAccounts(token, baseUrl) {
  return request(resolvedBaseUrl(baseUrl), 'GET', '/accounts', token);
}

async function listZones(token, baseUrl) {
  return request(resolvedBaseUrl(baseUrl), 'GET', '/zones', token);
}

async function createTunnel(token, accountId, name, baseUrl) {
  const tunnelSecret = crypto.randomBytes(32).toString('base64');
  return request(resolvedBaseUrl(baseUrl), 'POST', `/accounts/${accountId}/cfd_tunnel`, token, {
    name,
    tunnel_secret: tunnelSecret,
    config_src: 'cloudflare',
  });
}

async function getTunnelToken(token, accountId, tunnelId, baseUrl) {
  return request(resolvedBaseUrl(baseUrl), 'GET', `/accounts/${accountId}/cfd_tunnel/${tunnelId}/token`, token);
}

// Replaces the tunnel's ingress rules wholesale. Shared by createDnsRoute
// (initial setup) and pauseIngress/resumeIngress (the dashboard power
// button's connect/disconnect toggle) — same endpoint, different rule sets.
async function setIngress(token, accountId, tunnelId, ingress, baseUrl) {
  return request(resolvedBaseUrl(baseUrl), 'PUT', `/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`, token, {
    config: { ingress },
  });
}

// Points the tunnel's ingress at the local Paperweight server and creates the
// public CNAME. `localPort` is the Paperweight port the tunnel should route
// requests to on this machine.
async function createDnsRoute(token, accountId, tunnelId, zoneId, hostname, localPort, baseUrl) {
  baseUrl = resolvedBaseUrl(baseUrl);
  const configResult = await setIngress(token, accountId, tunnelId, [
    { hostname, service: `http://localhost:${localPort}` },
    { service: 'http_status:404' },
  ], baseUrl);
  if (!configResult.ok) return configResult;

  return request(baseUrl, 'POST', `/zones/${zoneId}/dns_records`, token, {
    type: 'CNAME',
    name: hostname,
    content: `${tunnelId}.cfargotunnel.com`,
    proxied: true,
  });
}

// Blackholes every request behind the tunnel with a 503, without touching
// the DNS record or the cloudflared connector itself — the connector stays
// up and connected, it just has nothing to route to. Used by the dashboard
// power button's "disconnect tunnel" action.
async function pauseIngress(token, accountId, tunnelId, baseUrl) {
  return setIngress(token, accountId, tunnelId, [{ service: 'http_status:503' }], baseUrl);
}

// Restores the working ingress rules pauseIngress replaced. Used by the
// dashboard power button's "reconnect tunnel" action.
async function resumeIngress(token, accountId, tunnelId, hostname, localPort, baseUrl) {
  return setIngress(token, accountId, tunnelId, [
    { hostname, service: `http://localhost:${localPort}` },
    { service: 'http_status:404' },
  ], baseUrl);
}

module.exports = {
  DEFAULT_BASE_URL,
  isCloudflareApiConfigured,
  verifyToken,
  listAccounts,
  listZones,
  createTunnel,
  getTunnelToken,
  createDnsRoute,
  pauseIngress,
  resumeIngress,
};
