const MAX_BODY_BYTES = 16 * 1024;

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (Buffer.byteLength(raw) > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Request body too large'), { statusCode: 413 }));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(Object.assign(new Error('Invalid JSON'), { statusCode: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function cleanBaseUrl(value) {
  if (!value || typeof value !== 'string') return null;
  return value.replace(/\/+$/, '');
}

function getAnalyticsBaseUrl() {
  return cleanBaseUrl(
    process.env.PAPERWEIGHT_ANALYTICS_BASE_URL ||
    process.env.PAPERWEIGHT_API_BASE_URL ||
    process.env.PAPE_URL
  );
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress || '';
}

async function proxyAnalytics(req, res, pathname) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.statusCode = 405;
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  try {
    const baseUrl = getAnalyticsBaseUrl();
    if (!baseUrl) {
      res.statusCode = 503;
      res.end(JSON.stringify({ error: 'PAPERWEIGHT_ANALYTICS_BASE_URL is not configured' }));
      return;
    }

    const body = await readJsonBody(req);
    const headers = {
      'Content-Type': 'application/json',
      'User-Agent': req.headers['user-agent'] || 'paperweight-vercel-download-page',
      'X-Forwarded-For': getClientIp(req),
    };

    if (req.headers.referer) headers.Referer = req.headers.referer;
    if (process.env.PAPERWEIGHT_ANALYTICS_SECRET) {
      headers['X-Analytics-Secret'] = process.env.PAPERWEIGHT_ANALYTICS_SECRET;
    }

    const upstream = await fetch(`${baseUrl}${pathname}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    const text = await upstream.text();
    res.statusCode = upstream.status;
    res.end(text || JSON.stringify({ ok: upstream.ok }));
  } catch (err) {
    res.statusCode = err.statusCode || 502;
    res.end(JSON.stringify({ error: err.message || 'Analytics proxy failed' }));
  }
}

module.exports = { proxyAnalytics };
