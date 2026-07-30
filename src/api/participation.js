'use strict';

const publicRouter = require('express').Router();
const dashRouter = require('express').Router();
const { requireDashboard } = require('../auth/middleware');
const { getDb } = require('../db');
const broadcast = require('../broadcast');
const participation = require('../participation');

publicRouter.get('/', (req, res) => res.json({ polls: participation.activePolls() }));
publicRouter.post('/requests', (req, res) => {
  const result = participation.submitRequest(req, Number(req.body?.mediaId), req.body?.dedication);
  if (result.error) return res.status(result.status || 400).json({ error: result.error });
  res.status(201).json(result.value);
});
publicRouter.post('/polls/:id/vote', (req, res) => {
  const result = participation.vote(req, Number(req.params.id), Number(req.body?.optionId));
  if (result.error) return res.status(result.status || 400).json({ error: result.error });
  res.json(result.value);
});
publicRouter.post('/reminders', (req, res) => {
  const result = participation.reminder(req, Number(req.body?.campaignId));
  if (result.error) return res.status(result.status || 400).json({ error: result.error });
  res.json(result.value);
});

dashRouter.use(requireDashboard);
dashRouter.get('/requests', (req, res) => {
  const rows = getDb().prepare(`
    SELECT lr.*, COALESCE(lp.display_name,la.email,'Listener') AS listener_name,
      COALESCE(m.title,m.filename) AS media_title
    FROM listener_requests lr LEFT JOIN listener_profiles lp ON lp.id=lr.profile_id
    LEFT JOIN listener_accounts la ON la.id=lr.listener_id JOIN media m ON m.id=lr.media_id
    ORDER BY CASE lr.status WHEN 'pending' THEN 0 ELSE 1 END, lr.created_at DESC LIMIT 200
  `).all();
  res.json({ requests: rows });
});
dashRouter.put('/requests/:id', (req, res) => {
  const status = req.body?.status;
  if (!['pending','accepted','played','declined'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  const db = getDb();
  const request = db.prepare('SELECT * FROM listener_requests WHERE id=?').get(req.params.id);
  if (!request) return res.status(404).json({ error: 'Request not found' });
  if (status === 'accepted' && !broadcast.addToStationQueue(request.media_id)) return res.status(409).json({ error: 'Station queue is full' });
  db.prepare("UPDATE listener_requests SET status=?,updated_at=datetime('now') WHERE id=?").run(status, request.id);
  res.json({ ok: true });
});
dashRouter.get('/polls', (req, res) => {
  const db = getDb();
  const polls = db.prepare('SELECT * FROM polls ORDER BY created_at DESC').all().map(poll => ({ ...poll,
    options: db.prepare('SELECT po.*,COUNT(pv.option_id) AS votes FROM poll_options po LEFT JOIN poll_votes pv ON pv.option_id=po.id WHERE po.poll_id=? GROUP BY po.id ORDER BY po.sort_order').all(poll.id),
  }));
  res.json({ polls });
});
dashRouter.post('/polls', (req, res) => {
  const result = participation.createPoll(req.body || {});
  if (result.error) return res.status(400).json({ error: result.error });
  res.status(201).json({ id: result.value });
});
dashRouter.put('/polls/:id/status', (req, res) => {
  const status = req.body?.status;
  if (!['draft','open','closed'].includes(status)) return res.status(400).json({ error: 'Invalid poll status' });
  const changes = getDb().prepare("UPDATE polls SET status=?,updated_at=datetime('now') WHERE id=?").run(status, req.params.id).changes;
  if (!changes) return res.status(404).json({ error: 'Poll not found' });
  res.json({ ok: true });
});

module.exports = publicRouter;
module.exports.dashRouter = dashRouter;
