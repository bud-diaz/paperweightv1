const { proxyAnalytics } = require('./_analytics-proxy');

module.exports = (req, res) => proxyAnalytics(req, res, '/api/download-lead');
