const { proxyAnalytics } = require('./_analytics-proxy');

module.exports = async function downloadLead(req, res) {
  try {
    await proxyAnalytics(req, res, '/api/download-lead');
  } catch (err) {
    console.error('[download-lead] unhandled proxy error', err);
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.statusCode = 502;
      res.end(JSON.stringify({ error: 'Analytics proxy failed' }));
    }
  }
};
