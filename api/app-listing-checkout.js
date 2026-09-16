const { proxyAnalytics } = require('./_analytics-proxy');

// Same-origin proxy for the public app-listing purchase on landing/app-listing.html.
//
// A proxy is required, not just tidy: System.Pape's app-listing endpoints are
// deliberately left out of its wide-open CORS allowlist (that list covers only
// the free directory endpoints), so a browser cannot call this one directly.
//
// Reuses the download-analytics proxy, which already resolves the System.Pape
// base URL from server-side env and forwards the client IP. The endpoint it
// targets is unauthenticated by design — a public purchase grants nothing on
// its own, it only mints a claim code that a station must redeem with its own
// telemetry secret.
module.exports = async function appListingCheckout(req, res) {
  try {
    await proxyAnalytics(req, res, '/api/modules/paperweight/app-listing/checkout/public');
  } catch (err) {
    console.error('[app-listing-checkout] unhandled proxy error', err);
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.statusCode = 502;
      res.end(JSON.stringify({ error: 'Checkout is unavailable right now.' }));
    }
  }
};
