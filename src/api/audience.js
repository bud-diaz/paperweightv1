'use strict';

const router = require('express').Router();
const { requireDashboard } = require('../auth/middleware');
const audience = require('../audience');

router.use(requireDashboard);

router.get('/people', (req, res) => {
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
  const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
  const people = audience.audienceRows({ search: req.query.search, limit, offset });
  res.json({ people, limit, offset, hasMore: people.length === limit });
});

router.get('/segments', (req, res) => {
  res.json({ segments: audience.segmentSummary() });
});

router.get('/segments/:key', (req, res) => {
  const people = audience.segmentPeople(req.params.key, 100);
  if (!people) return res.status(404).json({ error: 'Unknown segment' });
  res.json({ key: req.params.key, people });
});

router.get('/people/:id', (req, res) => {
  const result = audience.person(Number.parseInt(req.params.id, 10));
  if (!result) return res.status(404).json({ error: 'Listener not found' });
  res.json(result);
});

module.exports = router;
