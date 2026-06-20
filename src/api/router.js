const router = require('express').Router();
const { attachTier } = require('../auth/middleware');
const { generalLimiter } = require('../middleware/rateLimiter');
const config = require('../config');

// Attach tier and general rate limit to every API request
router.use(attachTier);
router.use(generalLimiter);

// Health check
router.get('/health', (req, res) => {
  res.json({ status: 'ok', station: config.station.name });
});

router.use('/auth', require('./auth'));

// v1 routes (unchanged)
router.use('/stream',    require('./stream'));
router.use('/library',   require('./library'));
router.use('/tokens',    require('./tokens'));
router.use('/schedule',  require('./schedule'));
router.use('/dashboard', require('./dashboard'));
router.use('/analytics', require('./analytics'));

// v1.5 routes (new)
router.use('/listener',  require('./listener'));
router.use('/payment',   require('./payment'));

// v2: vault pricing
// Listener routes: /api/vault/*
// Creator routes:  /api/dashboard/vault/* (requireDashboard applied inside dashRouter)
const vaultModule = require('./vault');
router.use('/vault',           vaultModule);
router.use('/dashboard/vault', vaultModule.dashRouter);

// Private share links (anonymous resolve, creator-managed)
// Listener routes: /api/share/*
// Creator routes:  /api/dashboard/share/* (requireDashboard applied inside dashRouter)
const shareModule = require('./share');
router.use('/share',           shareModule);
router.use('/dashboard/share', shareModule.dashRouter);

// Creator bio landing page (public profile + dashboard management)
router.use('/creator',   require('./creator'));

// Creator posts (Patreon-style text updates, tier-gated for listeners)
const postsModule = require('./posts');
router.use('/posts',           postsModule);
router.use('/dashboard/posts', postsModule.dashRouter);

// First-launch legal acceptance
router.use('/system',    require('./system'));

// Download page email capture (public, no auth required)
router.use('/download-lead', require('./download-lead'));

// downloads.js defines two routes:
//   GET /library/:id/signed-url  (mounted at / so becomes /api/library/:id/signed-url)
//   GET /download/:token         (mounted at / so becomes /api/download/:token)
router.use('/',          require('./downloads'));


module.exports = router;
