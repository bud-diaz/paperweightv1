const router = require('express').Router();
const { attachTier } = require('../auth/middleware');
const config = require('../config');

// Attach tier to every API request
router.use(attachTier);

// Health check
router.get('/health', (req, res) => {
  res.json({ status: 'ok', station: config.station.name, version: '1.0.0' });
});

router.use('/stream',    require('./stream'));
router.use('/library',   require('./library'));
router.use('/tokens',    require('./tokens'));
router.use('/schedule',  require('./schedule'));
router.use('/dashboard', require('./dashboard'));
router.use('/analytics', require('./analytics'));

module.exports = router;
