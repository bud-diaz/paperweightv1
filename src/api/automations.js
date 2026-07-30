'use strict';

const publicRouter = require('express').Router();
const dashRouter = require('express').Router();
const { requireDashboard } = require('../auth/middleware');
const { getDb } = require('../db');
const { getBoolSetting, setSetting } = require('../db/settings');
const automations = require('../automations');

publicRouter.get('/unsubscribe', (req, res) => {
  const ok = automations.unsubscribe(req.query.email, req.query.token);
  res.status(ok ? 200 : 400).type('html').send(ok
    ? '<!doctype html><title>Unsubscribed</title><p>You will no longer receive marketing email from this station.</p>'
    : '<!doctype html><title>Invalid link</title><p>This unsubscribe link is invalid.</p>');
});

dashRouter.use(requireDashboard);
dashRouter.get('/', (req, res) => {
  const runs = getDb().prepare(`
    SELECT ar.*, r.template_key, lp.display_name FROM automation_runs ar
    JOIN automation_rules r ON r.id=ar.rule_id LEFT JOIN listener_profiles lp ON lp.id=ar.profile_id
    ORDER BY ar.created_at DESC LIMIT 100
  `).all();
  res.json({ paused: getBoolSetting('automations_paused', false), rules: automations.listRules(), runs });
});
dashRouter.put('/pause', (req, res) => {
  setSetting('automations_paused', req.body?.paused ? '1' : '0');
  res.json({ ok: true, paused: !!req.body?.paused });
});
dashRouter.put('/rules/:id', (req, res) => {
  if (!automations.updateRule(Number(req.params.id), req.body || {})) return res.status(400).json({ error: 'Invalid automation rule' });
  res.json({ ok: true });
});
dashRouter.post('/runs/:id/send', (req, res) => {
  const result = automations.queueRun(Number(req.params.id));
  if (result.error) return res.status(409).json({ error: result.error });
  res.json(result);
});
dashRouter.post('/sweep', (req, res) => res.json({ created: automations.sweepInactive() }));

module.exports = publicRouter;
module.exports.dashRouter = dashRouter;
