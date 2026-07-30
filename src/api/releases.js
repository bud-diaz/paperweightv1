'use strict';

const publicRouter = require('express').Router();
const dashRouter = require('express').Router();
const { requireDashboard } = require('../auth/middleware');
const service = require('../releases/service');

publicRouter.get('/upcoming', (req, res) => {
  const releases = service.list().filter(item => item.status === 'scheduled' && String(item.release_at) > new Date().toISOString().slice(0, 19).replace('T', ' '))
    .slice(0, 10).map(item => ({ id: item.id, title: item.title, description: item.description, releaseAt: item.release_at, itemCount: item.item_count }));
  res.json({ releases });
});

dashRouter.use(requireDashboard);
dashRouter.get('/', (req, res) => res.json({ releases: service.list() }));
dashRouter.post('/', (req, res) => {
  const result = service.create(req.body);
  if (result.error) return res.status(400).json({ error: result.error });
  res.status(201).json(result.value);
});
dashRouter.get('/:id', (req, res) => {
  const release = service.get(Number(req.params.id));
  if (!release) return res.status(404).json({ error: 'Release not found' });
  res.json(release);
});
dashRouter.put('/:id', (req, res) => {
  const result = service.update(Number(req.params.id), req.body);
  if (result.error) return res.status(result.status || 400).json({ error: result.error });
  res.json(result.value);
});
dashRouter.post('/:id/publish', async (req, res, next) => {
  try { await service.publish(Number(req.params.id)); res.json(service.get(Number(req.params.id))); }
  catch (err) { next(err); }
});
dashRouter.post('/:id/cancel', (req, res) => {
  if (!service.cancel(Number(req.params.id))) return res.status(409).json({ error: 'Release cannot be cancelled' });
  res.json({ ok: true });
});
dashRouter.get('/:id/report', (req, res) => {
  const report = service.report(Number(req.params.id));
  if (!report) return res.status(404).json({ error: 'Release not found' });
  res.json(report);
});

module.exports = publicRouter;
module.exports.dashRouter = dashRouter;
